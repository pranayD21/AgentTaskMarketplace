import Stripe from "stripe";
import { MarketplaceError, type TaskStatus } from "@atm/shared";
import type { AgentRow, TaskRow } from "./db.js";
import { env } from "./env.js";
import { StripeMppProvider } from "./mpp.js";

export type PaymentMode = "card" | "mpp" | "mock";

export interface HoldResult {
  payment_state: "HELD" | "MOCK" | "AWAITING_PAYMENT";
  stripe_payment_intent_id: string | null;
  payment_link: string | null;
  task_status: TaskStatus;
  note: string;
}
/** Where the seller's money is after a capture or a retry (matches settlements.transfer_state, CONTRACT §9). */
export type TransferState = "TRANSFERRED" | "PENDING" | "NOT_APPLICABLE";
/** Why a transfer is still PENDING. MISMATCH needs an operator: a transfer exists but is not the one this task owes. */
export type PendingReason = "PENDING_ONBOARDING" | "PROVIDER_ERROR" | "LOOKUP_ERROR" | "MISMATCH";
export interface TransferOutcome {
  transfer_id: string | null;
  state: TransferState;
  pending_reason?: PendingReason;
  /** Cents actually moved by the transfer on the rail (0 unless TRANSFERRED). */
  amount_cents: number;
  /** True when the transfer already existed on Stripe and was adopted rather than created. */
  recovered?: boolean;
  note: string;
}
export interface RetryTransferOptions {
  /**
   * settlements.transfer_attempts at the time of the call. Each attempt gets its
   * own Stripe idempotency key: Stripe replays the stored *error* of a reused
   * key, so a fixed key could never recover after onboarding is repaired.
   * Attempt 0 keeps the historical key `atm:<task>:transfer`.
   */
  attempt?: number;
  /** settlements.stripe_transfer_id when one was recorded; verified, never duplicated. */
  known_transfer_id?: string | null;
  /** Capability poll override (tests). */
  poll?: { attempts?: number; delayMs?: number };
}
export interface CaptureResult {
  payment_state: "CAPTURED" | "MOCK";
  stripe_capture_id: string | null;
  stripe_transfer_id: string | null;
  /** settlements.payout_owed_cents: what the seller is owed for this task (the claim price). */
  owed_cents: number;
  /** settlements.payout_transferred_cents: what reached the seller's account; 0 while PENDING. */
  transferred_cents: number;
  transfer_state: TransferState;
  pending_reason?: PendingReason;
  note: string;
}
/** Money assertions: what the rail holds for a task right now (from Stripe or the mock ledger). */
export interface MoneyState {
  rail: PaymentMode;
  payment_intent_id: string | null;
  intent_status: string | null;
  /** Amount authorised (card hold) or charged (mpp) by the buyer. */
  authorized_cents: number;
  captured_cents: number;
  refunded_cents: number;
  transferred_cents: number;
  transfer_ids: string[];
}
export interface ReleaseResult {
  payment_state: "RELEASED" | "MOCK";
  note: string;
}

export interface PaymentProvider {
  readonly mode: PaymentMode;
  /** Human-readable label shown next to every amount. */
  readonly label: string;
  /** Minimum amount the rail accepts, in cents. */
  readonly min_cents: number;
  onboardBuyer(agent: { id: string; display_name: string }): Promise<Partial<AgentRow>>;
  onboardSeller(agent: { id: string; display_name: string }): Promise<Partial<AgentRow>>;
  hold(task: { id: string; max_price_cents: number }, buyer: AgentRow): Promise<HoldResult>;
  capture(task: TaskRow, seller: AgentRow | null, amountCents: number): Promise<CaptureResult>;
  release(task: TaskRow, reason: string): Promise<ReleaseResult>;
  /**
   * P1: undo a hold whose task row was never inserted (or whose insert failed).
   * Works from the HoldResult alone, is safe to call more than once, and throws
   * PAYMENT_FAILED (retryable) only when the rail could not confirm the undo.
   */
  compensateHold(task: { id: string; max_price_cents: number }, hold: HoldResult, reason: string): Promise<ReleaseResult>;
  /**
   * P2: finish a seller transfer that is still PENDING after a successful
   * capture (CONTRACT §9; A's sweep calls it with settlements.payout_owed_cents).
   * Exactly one transfer ever exists per task: a recorded id is verified, a
   * transfer Stripe already holds is adopted, and only then one is created.
   * Pass `opts.attempt = transfer_attempts` so every retry uses a fresh key.
   */
  retryTransfer(task: TaskRow, seller: AgentRow | null, amountCents: number, opts?: RetryTransferOptions): Promise<TransferOutcome>;
  /** Money assertions for fault tests and reconciliation; never mutates. */
  inspect(task: TaskRow): Promise<MoneyState>;
}

// ---------------------------------------------------------------------------
// Shared Stripe helpers (test mode only). Used by the card provider below and
// by the MPP provider in mpp.ts, so both rails onboard buyers and pay sellers
// the same way.
// ---------------------------------------------------------------------------

export const STRIPE_APP_INFO = { name: "agent-task-marketplace", version: "0.1.0" };

/** Builds a Stripe client and refuses anything but a test-mode secret key. */
export function createStripe(secretKey: string | undefined): Stripe {
  if (!secretKey || !secretKey.startsWith("sk_test_")) {
    throw new Error("Refusing to start: STRIPE_SECRET_KEY is not a test-mode key (sk_test_...).");
  }
  return new Stripe(secretKey, { appInfo: STRIPE_APP_INFO });
}

/** Buyer: Stripe Customer with the shared test card attached as default. */
export async function onboardBuyerCustomer(stripe: Stripe, agent: { id: string; display_name: string }): Promise<Partial<AgentRow>> {
  const customer = await stripe.customers.create({
    name: agent.display_name,
    description: `Buyer agent ${agent.id} (Agent Task Marketplace, test mode)`,
    metadata: { agent_id: agent.id, app: "agent-task-marketplace" },
  });
  // Stripe's shared test payment method; attaching clones it onto the customer.
  const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  return { stripe_customer_id: customer.id, stripe_payment_method_id: pm.id };
}

export type TransfersCapability = "active" | "pending" | "restricted" | "rejected" | "unsupported" | "unknown";

export interface PayoutStatus {
  account_id: string;
  /** `configuration.recipient.capabilities.stripe_balance.stripe_transfers.status` */
  transfers: TransfersCapability;
  /** Requirement entries that still restrict `stripe_balance.stripe_transfers`. */
  blocking: string[];
}

const ACCOUNT_INCLUDE = ["configuration.recipient", "requirements"] as const;

/**
 * Identity that satisfies the `stripe_transfers` requirements of a v2 recipient
 * account in TEST MODE without a hosted onboarding step. The values are
 * Stripe's documented test-mode verification values (DOB 1901-01-01, SSN last 4
 * 0000, address line "address_full_match"); they verify instantly in the
 * sandbox and would be rejected in live mode. A real deployment collects the
 * seller's own details through the hosted Account Link (see onboardingLink)
 * and keeps the terms-of-service attestation from the seller's actual request.
 */
function testModeRecipientIdentity(agent: { id: string; display_name: string }): Stripe.V2.Core.AccountCreateParams.Identity {
  return {
    country: "us",
    entity_type: "individual",
    individual: {
      given_name: "Test",
      surname: `Seller ${agent.id.slice(-6)}`,
      email: `${agent.id}@agenttaskmarket.dev`,
      phone: "+18885551234",
      date_of_birth: { day: 1, month: 1, year: 1901 },
      address: { country: "us", line1: "address_full_match", city: "San Francisco", state: "CA", postal_code: "94103" },
      id_numbers: [{ type: "us_ssn_last_4", value: "0000" }],
      metadata: { agent_id: agent.id, synthetic_identity: "stripe-test-mode-values" },
    },
    attestations: {
      terms_of_service: {
        account: { date: new Date().toISOString(), ip: "127.0.0.1", user_agent: "agent-task-marketplace/0.1.0 (test-mode seller onboarding)" },
      },
    },
  };
}

function recipientProfile(agent: { display_name: string }): Stripe.V2.Core.AccountCreateParams.Defaults.Profile {
  return {
    business_url: "https://agenttaskmarket.dev",
    product_description: `Seller agent "${agent.display_name}" rents idle local compute on the Agent Task Marketplace (test mode).`,
  };
}

function readPayoutStatus(account: Stripe.V2.Core.Account): PayoutStatus {
  const cap = account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers;
  const blocking = (account.requirements?.entries ?? [])
    .filter((e) => (e.impact?.restricts_capabilities ?? []).some((r) => r.capability === "stripe_balance.stripe_transfers"))
    .map((e) => e.description);
  return { account_id: account.id, transfers: (cap?.status as TransfersCapability | undefined) ?? "unknown", blocking };
}

/** Read the current transfers capability of a v2 recipient account. */
export async function payoutStatus(stripe: Stripe, accountId: string): Promise<PayoutStatus> {
  const account = await stripe.v2.core.accounts.retrieve(accountId, { include: [...ACCOUNT_INCLUDE] });
  return readPayoutStatus(account);
}

/**
 * Seller: v2 recipient account that can receive platform transfers.
 * Stripe refuses new Accounts v1 (type=custom) integrations, so this uses
 * /v2/core/accounts with the recipient configuration and requests the
 * `stripe_transfers` capability. With the test-mode identity above the
 * capability is active on creation (verified 2026-10-18 01:50 UTC).
 */
export async function createRecipientAccount(stripe: Stripe, agent: { id: string; display_name: string }): Promise<PayoutStatus> {
  const account = await stripe.v2.core.accounts.create({
    display_name: agent.display_name,
    contact_email: `${agent.id}@agenttaskmarket.dev`,
    dashboard: "none",
    defaults: {
      currency: "usd",
      responsibilities: { fees_collector: "application", losses_collector: "application" },
      profile: recipientProfile(agent),
    },
    identity: testModeRecipientIdentity(agent),
    configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
    metadata: { agent_id: agent.id, app: "agent-task-marketplace" },
    include: [...ACCOUNT_INCLUDE],
  });
  return readPayoutStatus(account);
}

/**
 * Make sure `stripe_transfers` is active on an existing account: accounts
 * created before identity onboarding existed are updated in place with the
 * test-mode identity, then the capability is polled (bounded).
 */
export async function ensureTransfersActive(
  stripe: Stripe,
  accountId: string,
  agent: { id: string; display_name: string },
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<PayoutStatus> {
  const attempts = opts.attempts ?? 5;
  const delayMs = opts.delayMs ?? 1000;
  let status = await payoutStatus(stripe, accountId);
  if (status.transfers === "active") return status;
  if (status.transfers === "restricted" || status.transfers === "unknown" || status.blocking.length) {
    try {
      const updated = await stripe.v2.core.accounts.update(accountId, {
        defaults: { profile: recipientProfile(agent) },
        identity: testModeRecipientIdentity(agent),
        configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
        include: [...ACCOUNT_INCLUDE],
      });
      status = readPayoutStatus(updated);
    } catch (err) {
      console.warn(`[stripe] could not complete onboarding for ${accountId}: ${(err as Error).message}`);
    }
  }
  for (let i = 0; status.transfers !== "active" && i < attempts; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    status = await payoutStatus(stripe, accountId);
  }
  return status;
}

/** Hosted Connect onboarding for a real seller (not used in the demo; documented in docs/payments). */
export async function onboardingLink(stripe: Stripe, accountId: string, baseUrl: string): Promise<string> {
  const link = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: { type: "account_onboarding", account_onboarding: { refresh_url: `${baseUrl}/api/dashboard`, return_url: `${baseUrl}/api/dashboard` } },
  });
  return link.url;
}

/** Non-reversed transfers Stripe holds for this task (by transfer_group), any destination. */
export async function findTransfersForTask(stripe: Stripe, taskId: string): Promise<Stripe.Transfer[]> {
  const page = await stripe.transfers.list({ transfer_group: taskId, limit: 10 });
  return page.data.filter((t) => !t.reversed);
}

/** A transfer counts for this task only if every money-relevant field matches what the task owes. */
export function transferMatches(t: Stripe.Transfer, expect: { task_id: string; destination: string; amount_cents: number }): string | null {
  const dest = typeof t.destination === "string" ? t.destination : t.destination?.id ?? null;
  if (t.reversed) return `transfer ${t.id} is reversed`;
  if (t.transfer_group !== expect.task_id) return `transfer ${t.id} belongs to ${t.transfer_group ?? "no task"}, not ${expect.task_id}`;
  if (dest !== expect.destination) return `transfer ${t.id} went to ${dest ?? "unknown"}, not ${expect.destination}`;
  if (t.currency !== "usd") return `transfer ${t.id} is ${t.currency}, not usd`;
  if (t.amount !== expect.amount_cents) return `transfer ${t.id} moved ${t.amount}c, task owes ${expect.amount_cents}c`;
  return null;
}

export function transferIdempotencyKey(taskId: string, attempt: number): string {
  return attempt === 0 ? `atm:${taskId}:transfer` : `atm:${taskId}:transfer:r${attempt}`;
}

/**
 * Move the captured amount to the seller's connected account — at most once
 * per task, and never mislabelled. Order: a recorded transfer id is verified
 * field by field; a transfer Stripe already holds for this task is adopted
 * only if it matches destination, amount, currency and group; anything that
 * exists but does not match becomes PENDING/MISMATCH for an operator instead
 * of being claimed as paid; only then is one created, with an attempt-scoped
 * idempotency key. `source_transaction` ties it to the buyer's charge.
 * Never throws: the outcome says whether and how much the seller was paid.
 *
 * Exactly-once across *concurrent* retries is the service's job: the lookup
 * cannot see a transfer another process is creating at the same moment, so
 * the sweep must hold a per-settlement lease/CAS before calling (CONTRACT §9).
 */
export async function reconcileSellerTransfer(
  stripe: Stripe,
  task: { id: string },
  seller: AgentRow | null,
  amountCents: number,
  chargeId: string | null,
  opts: RetryTransferOptions = {},
): Promise<TransferOutcome> {
  if (amountCents <= 0) return { transfer_id: null, state: "NOT_APPLICABLE", amount_cents: 0, note: "nothing owed to the seller" };
  if (!seller?.stripe_account_id) return { transfer_id: null, state: "PENDING", pending_reason: "PENDING_ONBOARDING", amount_cents: 0, note: "seller has no connected account (payout PENDING_ONBOARDING)" };
  const destination = seller.stripe_account_id;
  const expect = { task_id: task.id, destination, amount_cents: amountCents };

  if (opts.known_transfer_id) {
    try {
      const t = await stripe.transfers.retrieve(opts.known_transfer_id);
      const problem = transferMatches(t, expect);
      if (!problem) return { transfer_id: t.id, state: "TRANSFERRED", amount_cents: t.amount, note: `transfer ${t.id} verified (${t.amount}c to ${destination})` };
      return { transfer_id: null, state: "PENDING", pending_reason: "MISMATCH", amount_cents: 0, note: `recorded transfer does not match the task: ${problem}; needs operator reconciliation` };
    } catch (err) {
      return { transfer_id: null, state: "PENDING", pending_reason: "LOOKUP_ERROR", amount_cents: 0, note: `recorded transfer ${opts.known_transfer_id} could not be read: ${(err as Error).message}; retry pending` };
    }
  }

  let existing: Stripe.Transfer[];
  try {
    existing = await findTransfersForTask(stripe, task.id);
  } catch (err) {
    return { transfer_id: null, state: "PENDING", pending_reason: "LOOKUP_ERROR", amount_cents: 0, note: `transfer lookup failed: ${(err as Error).message}; retry pending` };
  }
  if (existing.length) {
    const match = existing.find((t) => transferMatches(t, expect) === null);
    if (match) return { transfer_id: match.id, state: "TRANSFERRED", amount_cents: match.amount, recovered: true, note: `recovered existing transfer ${match.id} (${match.amount}c to ${destination})` };
    const problems = existing.map((t) => transferMatches(t, expect)).filter(Boolean).join("; ");
    return { transfer_id: null, state: "PENDING", pending_reason: "MISMATCH", amount_cents: 0, note: `Stripe holds a transfer for this task that does not match what it owes (${problems}); not creating another; needs operator reconciliation` };
  }

  const status = await ensureTransfersActive(stripe, destination, seller, opts.poll ?? {});
  if (status.transfers !== "active") {
    return { transfer_id: null, state: "PENDING", pending_reason: "PENDING_ONBOARDING", amount_cents: 0, note: `transfer PENDING_ONBOARDING: ${destination} stripe_transfers=${status.transfers} (${status.blocking.join(", ") || "no details"})` };
  }
  const attempt = opts.attempt ?? 0;
  try {
    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: "usd",
      destination,
      transfer_group: task.id,
      ...(chargeId ? { source_transaction: chargeId } : {}),
      metadata: { task_id: task.id, seller_id: seller.id, app: "agent-task-marketplace", attempt: String(attempt) },
    }, { idempotencyKey: transferIdempotencyKey(task.id, attempt) });
    const problem = transferMatches(transfer, expect);
    if (problem) {
      // An idempotent replay of an older request with other parameters, or a partial transfer: do not call it paid.
      return { transfer_id: null, state: "PENDING", pending_reason: "MISMATCH", amount_cents: 0, note: `created transfer does not match the task: ${problem}; needs operator reconciliation` };
    }
    return { transfer_id: transfer.id, state: "TRANSFERRED", amount_cents: transfer.amount, note: `transferred ${transfer.amount}c to ${destination} (${transfer.id}${attempt ? `, attempt ${attempt}` : ""})` };
  } catch (err) {
    return { transfer_id: null, state: "PENDING", pending_reason: "PROVIDER_ERROR", amount_cents: 0, note: `transfer failed (attempt ${attempt}): ${(err as Error).message}; retry pending` };
  }
}

/** First-attempt transfer used by capture(); same reconciliation as a retry. */
export function transferToSeller(stripe: Stripe, task: { id: string }, seller: AgentRow | null, amountCents: number, chargeId: string | null): Promise<TransferOutcome> {
  return reconcileSellerTransfer(stripe, task, seller, amountCents, chargeId, { attempt: 0 });
}

/** P1 helper: cancel a card hold that belongs to a task that was never inserted. Idempotent. */
export async function compensateStripeHold(stripe: Stripe, task: { id: string }, hold: HoldResult, reason: string): Promise<ReleaseResult> {
  if (!hold.stripe_payment_intent_id) return { payment_state: "RELEASED", note: `no PaymentIntent to undo (${reason})` };
  try {
    const pi = await stripe.paymentIntents.cancel(hold.stripe_payment_intent_id, { cancellation_reason: "abandoned" }, { idempotencyKey: `atm:${task.id}:cancel` });
    return { payment_state: "RELEASED", note: `hold ${pi.id} cancelled (${reason})` };
  } catch (err) {
    // Already cancelled or captured? Read the truth before giving up.
    try {
      const pi = await stripe.paymentIntents.retrieve(hold.stripe_payment_intent_id);
      if (pi.status === "canceled") return { payment_state: "RELEASED", note: `hold ${pi.id} was already cancelled (${reason})` };
    } catch { /* fall through */ }
    throw new MarketplaceError("PAYMENT_FAILED", "Stripe could not confirm the hold was undone.", { retryable: true, next_action: `Retry compensation for ${task.id}; the cancel uses an idempotency key.` });
  }
}

/** Money state of a task on Stripe: intent, captured, refunded, transferred. Read-only. */
export async function inspectStripeMoney(stripe: Stripe, task: TaskRow): Promise<MoneyState> {
  const state: MoneyState = { rail: task.payment_mode, payment_intent_id: task.stripe_payment_intent_id, intent_status: null, authorized_cents: 0, captured_cents: 0, refunded_cents: 0, transferred_cents: 0, transfer_ids: [] };
  if (task.stripe_payment_intent_id) {
    const pi = await stripe.paymentIntents.retrieve(task.stripe_payment_intent_id);
    state.intent_status = pi.status;
    state.authorized_cents = pi.status === "canceled" ? 0 : pi.amount;
    state.captured_cents = pi.amount_received;
    const refunds = await stripe.refunds.list({ payment_intent: pi.id, limit: 20 });
    state.refunded_cents = refunds.data.filter((r) => r.status !== "failed" && r.status !== "canceled").reduce((sum, r) => sum + r.amount, 0);
  }
  for (const t of await findTransfersForTask(stripe, task.id)) {
    state.transfer_ids.push(t.id);
    state.transferred_cents += t.amount;
  }
  return state;
}

/** Shared seller onboarding used by both Stripe providers. Never throws. */
export async function onboardSellerAccount(stripe: Stripe, agent: { id: string; display_name: string }): Promise<Partial<AgentRow>> {
  try {
    const status = await createRecipientAccount(stripe, agent);
    if (status.transfers !== "active") {
      console.warn(`[stripe] ${status.account_id}: stripe_transfers=${status.transfers}; blocking: ${status.blocking.join(", ") || "none"}`);
    }
    return { stripe_account_id: status.account_id };
  } catch (err) {
    console.warn(`[stripe] connected account for ${agent.id} not created: ${(err as Error).message}`);
    return { stripe_account_id: null };
  }
}

// ---------------------------------------------------------------------------
// Mock: no money moves. Every surface that shows it says so.
// ---------------------------------------------------------------------------

/**
 * Fault injection for offline tests (PAYMENT_MODE=mock, DB_MODE=memory):
 * MOCK_PAYMENT_FAULTS="hold,capture,transfer:2,release,compensate"
 * A bare step fails every call; `step:N` fails the first N calls to that step.
 * `transfer` makes capture() report a failed transfer instead of throwing, so
 * the P2 retry path can be exercised; `retryTransfer` counts against the same
 * budget. setMockFaults() overrides the env for unit tests.
 */
export type MockFaultStep = "hold" | "capture" | "transfer" | "release" | "compensate";
let mockFaultSpec: string | null | undefined;
const mockFaultBudget = new Map<MockFaultStep, number>();
export function setMockFaults(spec: string | null): void {
  mockFaultSpec = spec;
  mockFaultBudget.clear();
  for (const entry of (spec ?? "").split(",").map((e) => e.trim()).filter(Boolean)) {
    const [step, n] = entry.split(":");
    mockFaultBudget.set(step as MockFaultStep, n === undefined ? Number.POSITIVE_INFINITY : Number(n));
  }
}
function mockFaultFires(step: MockFaultStep): boolean {
  if (mockFaultSpec === undefined) setMockFaults(process.env.MOCK_PAYMENT_FAULTS ?? null);
  const left = mockFaultBudget.get(step) ?? 0;
  if (left <= 0) return false;
  mockFaultBudget.set(step, left - 1);
  return true;
}

interface MockLedgerEntry { held: number; captured: number; refunded: number; transferred: number; transfer_id: string | null; state: "HELD" | "CAPTURED" | "RELEASED" }
const mockLedger = new Map<string, MockLedgerEntry>();
/** Test hook: the mock rail's ledger for a task. */
export function mockLedgerFor(taskId: string): MockLedgerEntry | undefined {
  return mockLedger.get(taskId);
}

class MockProvider implements PaymentProvider {
  readonly mode = "mock" as const;
  readonly label = "MOCK — no payment rail connected";
  readonly min_cents = 1;
  async onboardBuyer() { return {}; }
  async onboardSeller() { return {}; }
  async hold(task: { id: string; max_price_cents: number }): Promise<HoldResult> {
    if (mockFaultFires("hold")) throw new MarketplaceError("PAYMENT_FAILED", "MOCK fault: hold refused.", { retryable: true, next_action: "Retry post_task." });
    mockLedger.set(task.id, { held: task.max_price_cents, captured: 0, refunded: 0, transferred: 0, transfer_id: null, state: "HELD" });
    return { payment_state: "MOCK", stripe_payment_intent_id: `mock_pi_${task.id}`, payment_link: null, task_status: "OPEN", note: "mock hold (no payment rail)" };
  }
  async capture(task: TaskRow, seller: AgentRow | null, amountCents: number): Promise<CaptureResult> {
    if (mockFaultFires("capture")) throw new MarketplaceError("PAYMENT_FAILED", "MOCK fault: capture refused.", { retryable: true, next_action: "Retry submit_verdict." });
    const entry = mockLedger.get(task.id) ?? { held: task.max_price_cents, captured: 0, refunded: 0, transferred: 0, transfer_id: null, state: "HELD" as const };
    entry.captured = amountCents; // idempotent: a second capture does not add
    entry.state = "CAPTURED";
    mockLedger.set(task.id, entry);
    const transfer = await this.mockTransfer(task, seller, amountCents, 0);
    return {
      payment_state: "MOCK",
      stripe_capture_id: `mock_ch_${task.id}`,
      stripe_transfer_id: transfer.transfer_id,
      owed_cents: amountCents,
      transferred_cents: transfer.amount_cents,
      transfer_state: transfer.state,
      pending_reason: transfer.pending_reason,
      note: `mock payout of ${amountCents}c (no payment rail); ${transfer.note}`,
    };
  }
  async release(task: TaskRow, reason: string): Promise<ReleaseResult> {
    if (mockFaultFires("release")) throw new MarketplaceError("PAYMENT_FAILED", "MOCK fault: release refused.", { retryable: true, next_action: "Retry the same cancellation or verdict." });
    const entry = mockLedger.get(task.id);
    if (entry && entry.state !== "RELEASED") { entry.refunded = entry.captured || entry.held; entry.state = "RELEASED"; }
    return { payment_state: "MOCK", note: `mock release (no payment rail): ${reason}` };
  }
  async compensateHold(task: { id: string; max_price_cents: number }, _hold: HoldResult, reason: string): Promise<ReleaseResult> {
    if (mockFaultFires("compensate")) throw new MarketplaceError("PAYMENT_FAILED", "MOCK fault: compensation refused.", { retryable: true, next_action: "Retry compensation." });
    const entry = mockLedger.get(task.id);
    if (entry) { entry.state = "RELEASED"; entry.held = 0; }
    return { payment_state: "MOCK", note: `mock hold undone (${reason})` };
  }
  retryTransfer(task: TaskRow, seller: AgentRow | null, amountCents: number, opts: RetryTransferOptions = {}): Promise<TransferOutcome> {
    if (amountCents <= 0) return Promise.resolve({ transfer_id: null, state: "NOT_APPLICABLE", amount_cents: 0, note: "nothing owed to the seller" });
    return this.mockTransfer(task, seller, amountCents, opts.attempt ?? 0);
  }
  async inspect(task: TaskRow): Promise<MoneyState> {
    const e = mockLedger.get(task.id);
    return {
      rail: "mock",
      payment_intent_id: task.stripe_payment_intent_id,
      intent_status: e?.state ?? null,
      authorized_cents: e?.state === "RELEASED" ? 0 : e?.held ?? 0,
      captured_cents: e?.captured ?? 0,
      refunded_cents: e?.refunded ?? 0,
      transferred_cents: e?.transferred ?? 0,
      transfer_ids: e?.transfer_id ? [e.transfer_id] : [],
    };
  }
  private async mockTransfer(task: { id: string }, seller: AgentRow | null, amountCents: number, attempt: number): Promise<TransferOutcome> {
    const entry = mockLedger.get(task.id);
    if (entry?.transfer_id) {
      if (entry.transferred !== amountCents) return { transfer_id: null, state: "PENDING", pending_reason: "MISMATCH", amount_cents: 0, note: `mock transfer ${entry.transfer_id} moved ${entry.transferred}c, task owes ${amountCents}c; needs operator reconciliation` };
      return { transfer_id: entry.transfer_id, state: "TRANSFERRED", amount_cents: entry.transferred, recovered: attempt > 0, note: `mock transfer ${entry.transfer_id} already exists` };
    }
    if (!seller) return { transfer_id: null, state: "PENDING", pending_reason: "PENDING_ONBOARDING", amount_cents: 0, note: "seller unknown (payout PENDING_ONBOARDING)" };
    if (mockFaultFires("transfer")) return { transfer_id: null, state: "PENDING", pending_reason: "PROVIDER_ERROR", amount_cents: 0, note: `MOCK fault: transfer failed (attempt ${attempt}); retry pending` };
    const id = `mock_tr_${task.id}`;
    if (entry) { entry.transferred = amountCents; entry.transfer_id = id; }
    return { transfer_id: id, state: "TRANSFERRED", amount_cents: amountCents, note: `mock transfer ${id} of ${amountCents}c${attempt ? ` (attempt ${attempt})` : ""}` };
  }
}

// ---------------------------------------------------------------------------
// Stripe test mode, "card" flow: manual-capture hold at post_task, capture of
// the claim price on APPROVE (remainder auto-released), cancel on REJECT or
// expiry, Connect transfer of the captured amount to the seller.
// ---------------------------------------------------------------------------

class StripeCardProvider implements PaymentProvider {
  readonly mode = "card" as const;
  readonly label = "Stripe TEST MODE — manual-capture hold on the buyer's saved test card";
  readonly min_cents = 50; // Stripe minimum charge for USD
  private readonly stripe: Stripe;

  constructor(secretKey: string | undefined) {
    this.stripe = createStripe(secretKey);
  }

  onboardBuyer(agent: { id: string; display_name: string }): Promise<Partial<AgentRow>> {
    return onboardBuyerCustomer(this.stripe, agent);
  }

  onboardSeller(agent: { id: string; display_name: string }): Promise<Partial<AgentRow>> {
    return onboardSellerAccount(this.stripe, agent);
  }

  async hold(task: { id: string; max_price_cents: number }, buyer: AgentRow): Promise<HoldResult> {
    if (!buyer.stripe_customer_id || !buyer.stripe_payment_method_id) {
      throw new MarketplaceError("PAYMENT_FAILED", "Buyer has no payment method on file.", {
        next_action: "Re-register the buyer agent so a test card is attached.",
      });
    }
    let pi: Stripe.PaymentIntent;
    try {
      pi = await this.stripe.paymentIntents.create({
        amount: task.max_price_cents,
        currency: "usd",
        customer: buyer.stripe_customer_id,
        payment_method: buyer.stripe_payment_method_id,
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        confirm: true,
        off_session: true,
        capture_method: "manual",
        transfer_group: task.id,
        description: `Agent Task Marketplace hold for ${task.id} (TEST MODE)`,
        metadata: { task_id: task.id, buyer_id: buyer.id, app: "agent-task-marketplace" },
      });
    } catch (err) {
      throw new MarketplaceError("PAYMENT_FAILED", "Stripe refused the test-card hold.", { retryable: true, next_action: "Check the buyer test payment method and Stripe status, then retry post_task." });
    }
    if (pi.status !== "requires_capture") {
      throw new MarketplaceError("PAYMENT_FAILED", `Unexpected PaymentIntent status ${pi.status}; expected requires_capture.`, { next_action: "Check this PaymentIntent in Stripe before posting another task." });
    }
    return {
      payment_state: "HELD",
      stripe_payment_intent_id: pi.id,
      payment_link: null,
      task_status: "OPEN",
      note: `Stripe test-mode hold ${pi.id} for ${task.max_price_cents}c`,
    };
  }

  async capture(task: TaskRow, seller: AgentRow | null, amountCents: number): Promise<CaptureResult> {
    if (!task.stripe_payment_intent_id) {
      return { payment_state: "CAPTURED", stripe_capture_id: null, stripe_transfer_id: null, owed_cents: amountCents, transferred_cents: 0, transfer_state: "NOT_APPLICABLE", note: "no PaymentIntent on task; nothing captured" };
    }
    const pi = await this.stripe.paymentIntents.capture(task.stripe_payment_intent_id, { amount_to_capture: amountCents }, { idempotencyKey: `atm:${task.id}:capture` });
    const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;
    const transfer = await transferToSeller(this.stripe, task, seller, amountCents, chargeId);
    const note = `captured ${amountCents}c of the ${task.max_price_cents}c hold (${pi.id}); remainder released; ${transfer.note}`;
    return {
      payment_state: "CAPTURED",
      stripe_capture_id: chargeId,
      stripe_transfer_id: transfer.transfer_id,
      owed_cents: amountCents,
      transferred_cents: transfer.amount_cents,
      transfer_state: transfer.state,
      pending_reason: transfer.pending_reason,
      note,
    };
  }

  compensateHold(task: { id: string; max_price_cents: number }, hold: HoldResult, reason: string): Promise<ReleaseResult> {
    return compensateStripeHold(this.stripe, task, hold, reason);
  }

  async retryTransfer(task: TaskRow, seller: AgentRow | null, amountCents: number, opts: RetryTransferOptions = {}): Promise<TransferOutcome> {
    const chargeId = await this.chargeIdFor(task);
    return reconcileSellerTransfer(this.stripe, task, seller, amountCents, chargeId, opts);
  }

  /** The buyer's charge for `source_transaction`, read from the PaymentIntent. */
  private async chargeIdFor(task: TaskRow): Promise<string | null> {
    if (!task.stripe_payment_intent_id) return null;
    try {
      const pi = await this.stripe.paymentIntents.retrieve(task.stripe_payment_intent_id);
      return typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;
    } catch {
      return null;
    }
  }

  inspect(task: TaskRow): Promise<MoneyState> {
    return inspectStripeMoney(this.stripe, task);
  }

  async release(task: TaskRow, reason: string): Promise<ReleaseResult> {
    if (!task.stripe_payment_intent_id) return { payment_state: "RELEASED", note: "no PaymentIntent on task" };
    try {
      const pi = await this.stripe.paymentIntents.cancel(task.stripe_payment_intent_id, { cancellation_reason: "requested_by_customer" }, { idempotencyKey: `atm:${task.id}:cancel` });
      return { payment_state: "RELEASED", note: `hold ${pi.id} cancelled (${reason})` };
    } catch (err) {
      throw new MarketplaceError("PAYMENT_FAILED", "Stripe could not confirm release of the hold.", { retryable: true, next_action: "Retry the same cancellation or verdict after checking Stripe." });
    }
  }
}

// ---------------------------------------------------------------------------
// Routing: settlement follows the task's own payment_mode. Tasks posted while
// the server ran in one mode must still capture/release correctly when a
// different server (or the same one restarted in another mode) judges them —
// the Insforge DB is shared by every computer during the hackathon.
// ---------------------------------------------------------------------------

class RoutingProvider implements PaymentProvider {
  private readonly byMode = new Map<PaymentMode, PaymentProvider>();

  constructor(private readonly configured: PaymentProvider, private readonly e: { STRIPE_SECRET_KEY?: string | undefined; STRIPE_PROFILE_ID?: string | undefined; baseUrl: string }) {
    this.byMode.set(configured.mode, configured);
  }
  get mode() { return this.configured.mode; }
  get label() { return this.configured.label; }
  get min_cents() { return this.configured.min_cents; }
  onboardBuyer(agent: { id: string; display_name: string }) { return this.configured.onboardBuyer(agent); }
  onboardSeller(agent: { id: string; display_name: string }) { return this.configured.onboardSeller(agent); }
  hold(task: { id: string; max_price_cents: number }, buyer: AgentRow) { return this.configured.hold(task, buyer); }
  capture(task: TaskRow, seller: AgentRow | null, amountCents: number) { return this.for(task.payment_mode).capture(task, seller, amountCents); }
  release(task: TaskRow, reason: string) { return this.for(task.payment_mode).release(task, reason); }
  compensateHold(task: { id: string; max_price_cents: number }, hold: HoldResult, reason: string) { return this.configured.compensateHold(task, hold, reason); }
  retryTransfer(task: TaskRow, seller: AgentRow | null, amountCents: number, opts?: RetryTransferOptions) { return this.for(task.payment_mode).retryTransfer(task, seller, amountCents, opts); }
  inspect(task: TaskRow) { return this.for(task.payment_mode).inspect(task); }

  /** Settlement must use the stored rail; configuration errors must not select a different rail. */
  for(mode: PaymentMode): PaymentProvider {
    const cached = this.byMode.get(mode);
    if (cached) return cached;
    let p: PaymentProvider;
    try {
      p = buildProvider(mode, this.e);
    } catch {
      throw new MarketplaceError("PAYMENT_FAILED", `This server cannot settle ${mode} tasks with its current configuration.`, {
        next_action: "Configure the task's payment rail on this server, then retry the same operation.",
      });
    }
    this.byMode.set(mode, p);
    return p;
  }
}

function buildProvider(mode: PaymentMode, e: { STRIPE_SECRET_KEY?: string | undefined; STRIPE_PROFILE_ID?: string | undefined; baseUrl: string }): PaymentProvider {
  switch (mode) {
    case "mock":
      return new MockProvider();
    case "card":
      return new StripeCardProvider(e.STRIPE_SECRET_KEY);
    case "mpp":
      // Defined in mpp.ts (Computer D). payments.ts ↔ mpp.ts import each other;
      // that is safe because neither touches the other's exports at module top level.
      return new StripeMppProvider(e.STRIPE_SECRET_KEY, e.STRIPE_PROFILE_ID, e.baseUrl);
  }
}

let provider: RoutingProvider | undefined;

export function payments(): PaymentProvider {
  if (provider) return provider;
  const e = env();
  provider = new RoutingProvider(buildProvider(e.PAYMENT_MODE, e), e);
  console.log(`[payments] mode=${provider.mode}: ${provider.label}`);
  return provider;
}

/** The MPP provider when this server can run one (needs STRIPE_PROFILE_ID), whatever PAYMENT_MODE is. */
export function mppProvider(): StripeMppProvider | null {
  payments();
  try {
    const p = provider!.for("mpp");
    return p instanceof StripeMppProvider ? p : null;
  } catch { return null; }
}
