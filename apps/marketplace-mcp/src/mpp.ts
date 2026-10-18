/**
 * PAYMENT_MODE=mpp — Stripe Machine Payments Protocol (test mode, preview).
 *
 * The buyer agent pays for the task itself: `post_task` creates the task in
 * AWAITING_PAYMENT and hands back `payment_link`. A POST to that link answers
 * HTTP 402 with a `WWW-Authenticate: Payment …` challenge (mppx, method
 * `stripe/charge`). The agent's wallet (Stripe Link CLI, human approves the
 * spend on their phone) retries with a Shared Payment Token credential; mppx
 * creates and confirms the PaymentIntent for `max_price_cents`, and the task
 * flips to OPEN with `payment_state = PAID`.
 *
 * Settlement: APPROVE refunds `max − price` to the buyer and transfers `price`
 * to the seller's connected account; REJECT / cancel / expiry refunds in full.
 *
 * Computer D owns this file. It imports helpers from payments.ts and
 * payments.ts imports `StripeMppProvider` from here; the cycle is safe because
 * nothing here touches payments.ts exports at module top level.
 */
import type Stripe from "stripe";
import { Receipt } from "mppx";
import { generate as generateOpenApi } from "mppx/discovery";
import { Mppx, stripe as mppStripe } from "mppx/server";
import { sha256Hex, utf8 } from "@atm/crypto";
import { MarketplaceError, isPast, nowIso } from "@atm/shared";
import { adjustBuyerBalance, adjustJobBudget, db, logEvent, one, unwrap, type AgentRow, type TaskRow } from "./db.js";
import { env } from "./env.js";
import {
  compensateStripeHold,
  createStripe,
  inspectStripeMoney,
  onboardSellerAccount,
  reconcileSellerTransfer,
  sellerPayoutOnboarding,
  transferToSeller,
  type CaptureResult,
  type HoldResult,
  type MoneyState,
  type PaymentProvider,
  type PayoutOnboarding,
  type ReleaseResult,
  type RetryTransferOptions,
  type SellerOnboardInput,
  type TransferOutcome,
} from "./payments.js";

/** Task payment state once the MPP charge succeeded (money is captured, not merely authorised). */
export const MPP_PAID_STATE = "PAID";

export class StripeMppProvider implements PaymentProvider {
  readonly mode = "mpp" as const;
  readonly label =
    "Stripe TEST MODE — Machine Payments Protocol (preview): the buyer agent pays an HTTP 402 challenge from its own Link wallet; a human approves each spend";
  readonly min_cents = 50; // Stripe minimum card charge for USD, also enforced by mppx
  readonly stripe: Stripe;
  readonly networkId: string;
  readonly baseUrl: string;

  constructor(secretKey: string | undefined, profileId: string | undefined, baseUrl: string) {
    this.stripe = createStripe(secretKey);
    if (!profileId) {
      throw new Error("PAYMENT_MODE=mpp needs STRIPE_PROFILE_ID (profile_test_…, the Stripe Business Network profile id).");
    }
    this.networkId = profileId;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /** The buyer pays from its own wallet; the marketplace stores no card for it. */
  async onboardBuyer(): Promise<Partial<AgentRow>> {
    return {};
  }

  onboardSeller(agent: SellerOnboardInput): Promise<Partial<AgentRow>> {
    return onboardSellerAccount(this.stripe, agent);
  }

  async hold(task: { id: string; max_price_cents: number }): Promise<HoldResult> {
    const link = this.paymentLink(task.id);
    return {
      payment_state: "AWAITING_PAYMENT",
      stripe_payment_intent_id: null,
      payment_link: link,
      task_status: "AWAITING_PAYMENT",
      note: `Not listed yet: pay ${task.max_price_cents}c (Stripe test mode) at ${link}. POST it to receive an HTTP 402 Machine Payments Protocol challenge; pay it with your Link agent wallet (link-cli mpp pay ${link} --test). The task becomes OPEN once the payment succeeds.`,
    };
  }

  async capture(task: TaskRow, seller: AgentRow | null, amountCents: number): Promise<CaptureResult> {
    if (!task.stripe_payment_intent_id) {
      return { payment_state: "CAPTURED", stripe_capture_id: null, stripe_transfer_id: null, owed_cents: amountCents, transferred_cents: 0, transfer_state: "NOT_APPLICABLE", transfer_retry_safe_to_advance: false, note: "no PaymentIntent on task (never paid); nothing captured" };
    }
    const pi = await this.stripe.paymentIntents.retrieve(task.stripe_payment_intent_id);
    const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;
    const remainder = Math.max(0, task.max_price_cents - amountCents);
    let note = `MPP payment ${pi.id} of ${task.max_price_cents}c kept ${amountCents}c`;
    if (remainder > 0) {
      try {
        const refund = await this.stripe.refunds.create({ payment_intent: pi.id, amount: remainder, metadata: { task_id: task.id, reason: "price below max" } }, { idempotencyKey: `atm:${task.id}:refund-remainder` });
        note += `; refunded ${remainder}c to the buyer (${refund.id})`;
      } catch (err) {
        throw new MarketplaceError("PAYMENT_FAILED", "Stripe could not confirm the unused-budget refund.", { retryable: true, next_action: "Retry the same verdict after checking Stripe; the refund uses an idempotency key." });
      }
    }
    const transfer = await transferToSeller(this.stripe, task, seller, amountCents, chargeId);
    note += `; ${transfer.note}`;
    return {
      payment_state: "CAPTURED",
      stripe_capture_id: chargeId,
      stripe_transfer_id: transfer.transfer_id,
      owed_cents: amountCents,
      transferred_cents: transfer.amount_cents,
      transfer_state: transfer.state,
      pending_reason: transfer.pending_reason,
      transfer_retry_safe_to_advance: transfer.retry_safe_to_advance,
      note,
    };
  }

  /** An AWAITING_PAYMENT task holds no money; a paid one is refunded in full. */
  async compensateHold(task: { id: string; max_price_cents: number }, hold: HoldResult, reason: string): Promise<ReleaseResult> {
    if (!hold.stripe_payment_intent_id) return { payment_state: "RELEASED", note: `nothing to undo: task was never paid (${reason})` };
    return compensateStripeHold(this.stripe, task, hold, reason);
  }

  async retryTransfer(task: TaskRow, seller: AgentRow | null, amountCents: number, opts: RetryTransferOptions = {}): Promise<TransferOutcome> {
    let chargeId: string | null = null;
    if (task.stripe_payment_intent_id) {
      try {
        const pi = await this.stripe.paymentIntents.retrieve(task.stripe_payment_intent_id);
        chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;
      } catch { /* transfer without source_transaction */ }
    }
    return reconcileSellerTransfer(this.stripe, task, seller, amountCents, chargeId, opts);
  }

  inspect(task: TaskRow): Promise<MoneyState> {
    return inspectStripeMoney(this.stripe, task);
  }

  payoutOnboarding(agent: { id: string; stripe_account_id: string | null }, opts: { includeLink?: boolean } = {}): Promise<PayoutOnboarding> {
    return sellerPayoutOnboarding(this.stripe, agent, this.baseUrl, opts);
  }

  async release(task: TaskRow, reason: string): Promise<ReleaseResult> {
    if (!task.stripe_payment_intent_id) return { payment_state: "RELEASED", note: `never paid (${reason}); nothing to refund` };
    try {
      const refund = await this.stripe.refunds.create({ payment_intent: task.stripe_payment_intent_id, metadata: { task_id: task.id, reason } }, { idempotencyKey: `atm:${task.id}:refund-full` });
      return { payment_state: "RELEASED", note: `MPP payment ${task.stripe_payment_intent_id} refunded in full (${refund.id}): ${reason}` };
    } catch (err) {
      throw new MarketplaceError("PAYMENT_FAILED", "Stripe could not confirm the full refund.", { retryable: true, next_action: "Retry the same cancellation or verdict after checking Stripe." });
    }
  }

  paymentLink(taskId: string): string {
    return `${this.baseUrl}/api/pay/${taskId}`;
  }

  // ---------------------------------------------------------------- mppx

  private mppx?: ReturnType<typeof buildMppx>;

  /** Lazily built so the server still boots when mppx cannot (misconfiguration surfaces on first /api/pay). */
  handler(): ReturnType<typeof buildMppx> {
    this.mppx ??= buildMppx(this);
    return this.mppx;
  }

  /**
   * MPP discovery document (OpenAPI 3 + `x-payment-info`) served at /openapi.json
   * so wallets and `mppx validate` can find the paid route without a task id.
   * The amount shown is the rail minimum; each task's challenge carries its own.
   */
  discoveryDocument(): Record<string, unknown> {
    const mppx = this.handler();
    return generateOpenApi(mppx, {
      info: { title: "Agent Task Marketplace — task payments (Stripe TEST MODE)", version: "0.1.0" },
      routes: [
        {
          method: "POST",
          path: "/api/pay/{task_id}",
          summary: "Pay a posted task's max price with a Shared Payment Token (Machine Payments Protocol). The task becomes OPEN for sellers once paid.",
          requestBody: { required: false, content: { "application/json": { schema: { type: "object", description: "No body needed; the task id in the path selects the amount." } } } },
          handler: mppx.charge({ amount: (this.min_cents / 100).toFixed(2), description: "Agent Task Marketplace task (max price; the real amount is in each task's challenge)" }),
        },
      ],
    });
  }
}

/** HMAC key for mppx challenge ids: MPP_SECRET_KEY, else derived from the server KEK. */
function mppSecret(): string {
  const explicit = env().MPP_SECRET_KEY;
  if (explicit && explicit.length >= 32) return explicit;
  return sha256Hex(utf8(`atm-mpp-challenge-hmac:${env().SERVER_KEK_B64}`));
}

function buildMppx(p: StripeMppProvider) {
  const method = mppStripe.charge({
    client: p.stripe,
    networkId: p.networkId,
    currency: "usd",
    decimals: 2,
    paymentMethodTypes: ["card", "link"],
    metadata: { app: "agent-task-marketplace", mode: "stripe-test" },
    // Tag the PaymentIntent with the task so the seller transfer reconciles in the dashboard.
    connect: ({ request }) => (request.externalId ? { transferGroup: request.externalId } : undefined),
  });
  return Mppx.create({ methods: [method], secretKey: mppSecret(), realm: new URL(p.baseUrl).hostname });
}

// ---------------------------------------------------------------------------
// Paying a task
// ---------------------------------------------------------------------------

export interface PayOutcome {
  response: Response;
  /** Set when this request completed a payment. */
  paid?: { task_id: string; payment_intent_id: string };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json" } });
}

/**
 * Drive the MPP exchange for one task. First call without a credential → 402
 * challenge. Call with a valid `Authorization: Payment …` credential → Stripe
 * charge, task flips to OPEN, 200 with a `Payment-Receipt` header.
 */
export async function payTask(provider: StripeMppProvider, taskId: string, request: Request): Promise<PayOutcome> {
  const task = one<TaskRow>(await db().from("tasks").select("*").eq("id", taskId).limit(1));
  const t = await task;
  if (!t) return { response: json({ error: { code: "NOT_FOUND", message: `Task ${taskId} not found.` } }, 404) };
  if (t.payment_mode !== "mpp") {
    return { response: json({ error: { code: "INVALID_STATE", message: `Task ${taskId} was posted in ${t.payment_mode} mode; nothing to pay here.` } }, 409) };
  }
  if (t.status !== "AWAITING_PAYMENT") {
    const paid = t.payment_state === MPP_PAID_STATE || t.payment_state === "CAPTURED" || t.payment_state === "RELEASED";
    return {
      response: json(
        { ok: paid, task_id: t.id, status: t.status, payment_state: t.payment_state, message: paid ? "Already paid." : `Task is ${t.status}; it cannot be paid.` },
        paid ? 200 : 409,
      ),
    };
  }
  if (isPast(t.expires_at)) {
    return { response: json({ error: { code: "INVALID_STATE", message: "Listing deadline passed before payment; post a new task." } }, 410) };
  }

  // Wallets pin the challenge they asked a human to approve and refuse to pay
  // if a re-probe returns a different one (Stripe Link CLI compares everything
  // but id/expires, and mppx puts a fresh nonce in `opaque` on every issuance).
  // So an unauthenticated probe gets the same challenge back until it expires.
  const hasCredential = /^payment\s/i.test(request.headers.get("authorization") ?? "");
  if (!hasCredential) {
    const cached = challengeFor(t.id);
    if (cached) return { response: cached };
  }

  const result = await provider.handler().charge({
    amount: (t.max_price_cents / 100).toFixed(2),
    description: `Agent Task Marketplace task ${t.id} (max price, TEST MODE)`,
    externalId: t.id,
    paymentIntentOptions: { metadata: { task_id: t.id, buyer_id: t.buyer_id } },
  })(request);

  if (result.status === 402) return { response: rememberChallenge(t.id, result.challenge) };
  forgetChallenge(t.id);

  const receipted = await result.withReceipt(json({ ok: true, task_id: t.id, status: "OPEN", payment_state: MPP_PAID_STATE, amount_cents: t.max_price_cents, label: provider.label }));
  const receipt = Receipt.fromResponse(receipted);
  try {
    await assertTestMoney(provider.stripe, receipt.reference, t.max_price_cents);
    await markTaskPaid(t, receipt.reference);
  } catch (err) {
    // Money moved but the task could not be opened: give it back rather than strand it.
    console.error(`[mpp] task ${t.id} paid (${receipt.reference}) but could not be opened: ${(err as Error).message}`);
    let refunded = false;
    try {
      await provider.stripe.refunds.create({ payment_intent: receipt.reference, metadata: { task_id: t.id, reason: "mark-paid failed" } }, { idempotencyKey: `atm:${t.id}:${receipt.reference}:refund-unopened` });
      refunded = true;
    } catch { /* report uncertainty; never claim a failed refund succeeded */ }
    return { response: json({ error: {
      code: "PAYMENT_FAILED",
      message: refunded ? "Task could not be opened; the payment was refunded." : "Task could not be opened and the refund is unconfirmed.",
      retryable: refunded,
      next_action: refunded ? "Check your available budget before paying again." : "Ask the operator to reconcile the Stripe payment before paying again.",
    } }, 500) };
  }
  return { response: receipted, paid: { task_id: t.id, payment_intent_id: receipt.reference } };
}

/**
 * Hard stop: this marketplace never moves real money. The client is built
 * from an sk_test_ key, so Stripe would already reject a live token, but the
 * PaymentIntent is checked anyway; anything live or over the task's price
 * is refunded by the caller.
 */
export async function assertTestMoney(stripe: Stripe, paymentIntentId: string, maxCents: number): Promise<void> {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (pi.livemode) throw new MarketplaceError("PAYMENT_FAILED", `PaymentIntent ${pi.id} is LIVE MODE; this marketplace only accepts Stripe test money.`);
  if (pi.currency !== "usd" || pi.amount > maxCents) {
    throw new MarketplaceError("PAYMENT_FAILED", `PaymentIntent ${pi.id} is ${pi.amount} ${pi.currency}; expected at most ${maxCents} usd.`);
  }
}

// ---------------------------------------------------------------- challenge pinning

interface PinnedChallenge { header: string; body: string; status: number; expiresAt: number }
const pinned = new Map<string, PinnedChallenge>();
const PIN_FALLBACK_MS = 4 * 60 * 1000; // mppx challenges default to 5 min

function rememberChallenge(taskId: string, challenge: Response): Response {
  const header = challenge.headers.get("www-authenticate");
  if (!header) return challenge;
  const expires = /expires="([^"]+)"/.exec(header)?.[1];
  const expiresAt = expires && !Number.isNaN(Date.parse(expires)) ? Date.parse(expires) - 15_000 : Date.now() + PIN_FALLBACK_MS;
  // Clone so the original body can still be streamed to this caller.
  const copy = challenge.clone();
  void copy.text().then((body) => pinned.set(taskId, { header, body, status: challenge.status, expiresAt }));
  return challenge;
}

function challengeFor(taskId: string): Response | null {
  const c = pinned.get(taskId);
  if (!c) return null;
  if (c.expiresAt <= Date.now()) {
    pinned.delete(taskId);
    return null;
  }
  return new Response(c.body, { status: c.status, headers: { "www-authenticate": c.header, "content-type": "application/json" } });
}

function forgetChallenge(taskId: string): void {
  pinned.delete(taskId);
}

/**
 * AWAITING_PAYMENT → OPEN once the PaymentIntent succeeded. Atomic on status so
 * a second successful payment for the same task is detected (and refunded by
 * the caller) instead of double-opening. Mirrors service.ts conventions; A may
 * move this into service.ts as `markTaskPaid`.
 */
export async function markTaskPaid(task: TaskRow, paymentIntentId: string): Promise<TaskRow> {
  const max = task.max_price_cents;
  // Keys are per payment attempt, not per task: a task-level key would be
  // consumed by a failed-and-compensated attempt, so a later payment (or a
  // replay of the refunded one) could open the task with no live reservation,
  // and a losing concurrent payment could undo the winner's reservation.
  const key = `paid:${task.id}:${paymentIntentId}`;
  const undoKey = `unpaid:${task.id}:${paymentIntentId}`;

  // Replay of the payment that already opened this task: nothing to do.
  const before = await one<TaskRow>(await db().from("tasks").select("*").eq("id", task.id).limit(1));
  if (!before) throw new MarketplaceError("NOT_FOUND", `Task ${task.id} not found.`);
  if (before.stripe_payment_intent_id === paymentIntentId && before.status !== "AWAITING_PAYMENT") return before;

  // Reserve the full offer against the buyer cap and, for a job part, the job
  // budget. `applied` tells us whether THIS call changed a ledger; only what we
  // applied is ever compensated. A key already consumed together with its undo
  // key means this payment attempt was refunded: it cannot open the task.
  const reserved = await adjustBuyerBalance(task.buyer_id, { reserved: max }, { enforceCap: true, key });
  if (!reserved.buyer || reserved.refused) {
    throw new MarketplaceError("SPEND_CAP_EXCEEDED", "The buyer has insufficient remaining budget for this payment.", {
      next_action: "Check whoami and release unwanted holds before paying another task.",
    });
  }
  if (!reserved.applied && (reserved.buyer.balance_keys ?? []).includes(undoKey)) {
    throw new MarketplaceError("INVALID_STATE", `Payment ${paymentIntentId} for ${task.id} was already refunded; it cannot open the task.`, {
      next_action: "Pay the task again; a new payment gets a new reservation.",
    });
  }
  const buyerApplied = reserved.applied;
  let jobApplied = false;
  if (task.job_id) {
    const jr = await adjustJobBudget(task.job_id, { reserved: max }, { enforceCap: true, key });
    if (!jr.job || jr.refused) {
      if (buyerApplied) await adjustBuyerBalance(task.buyer_id, { reserved: -max }, { key: undoKey });
      throw new MarketplaceError("JOB_BUDGET_EXCEEDED", `Paying this part would exceed the job's budget${jr.job ? ` of ${jr.job.budget_cents}c (reserved ${jr.job.reserved_cents}c, spent ${jr.job.spent_cents}c)` : ""}.`, {
        next_action: "Create a job with a larger budget, or wait for other parts to settle; the payment is refunded.",
      });
    }
    jobApplied = jr.applied;
  }
  let rows: TaskRow[];
  try {
    rows = unwrap(
      await db().from("tasks")
        .update({ status: "OPEN", payment_state: MPP_PAID_STATE, stripe_payment_intent_id: paymentIntentId, updated_at: nowIso() })
        .eq("id", task.id).eq("status", "AWAITING_PAYMENT").select(),
    ) as TaskRow[];
    if (!rows.length) {
      throw new MarketplaceError("INVALID_STATE", `Task ${task.id} is no longer AWAITING_PAYMENT.`, {
        next_action: "Read get_task to check its current state before retrying payment.",
      });
    }
  } catch (err) {
    // This payment lost (another payment opened the task, or it was cancelled):
    // give back only the reservation this call made; the winner's stays.
    const current = await one<TaskRow>(await db().from("tasks").select("*").eq("id", task.id).limit(1));
    if (current?.stripe_payment_intent_id === paymentIntentId && current.status !== "AWAITING_PAYMENT") return current;
    if (buyerApplied) await adjustBuyerBalance(task.buyer_id, { reserved: -max }, { key: undoKey });
    if (jobApplied && task.job_id) await adjustJobBudget(task.job_id, { reserved: -max }, { key: undoKey });
    throw err;
  }
  await logEvent("task.paid", { task_id: task.id, agent_id: task.buyer_id, meta: { amount_cents: max, rail: "stripe-mpp-test", payment_intent: paymentIntentId, job_id: task.job_id ?? null } });
  return rows[0]!;
}
