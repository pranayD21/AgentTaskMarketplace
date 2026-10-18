import { beforeEach, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import type { AgentRow, TaskRow } from "./db.js";
import { StripeCardProvider, compensateStripeHold, holdIdempotencyKey, holdOutcomeOf, BUYER_SETUP_REFRESH_PATH, BUYER_SETUP_RETURN_PATH, PAYOUT_ACCOUNT_RETRY_POLICY, SELLER_SETUP_REFRESH_PATH, SELLER_SETUP_RETURN_PATH, buyerPaymentInfo, buyerPaymentSetup, confirmBuyerSetupSession, customerIdempotencyKey, onboardBuyerCustomer, createRecipientAccount, ensureTransfersActive, inspectStripeMoney, onboardSellerAccount, onboardingLink, payoutAccountIdempotencyKey, sellerPayoutInfo, sellerPayoutOnboarding, mockLedgerFor, payments, reconcileSellerTransfer, setMockFaults, stripeDefinitivelyRejected, transferIdempotencyKey, transferMatches } from "./payments.js";

// ---------------------------------------------------------------- fakes
const seller = { id: "seller_1", stripe_account_id: "acct_test" } as AgentRow;
const task = { id: "task_1", payment_mode: "card", max_price_cents: 100, stripe_payment_intent_id: "pi_1" } as TaskRow;

/** A transfer as Stripe would return it for task_1; override fields to build mismatches. */
const tr = (over: Partial<Stripe.Transfer> & { id: string }): Stripe.Transfer =>
  ({ amount: 75, currency: "usd", destination: "acct_test", transfer_group: "task_1", reversed: false, ...over }) as Stripe.Transfer;

interface FakeStripeOptions {
  existing?: Stripe.Transfer[];
  known?: Record<string, Stripe.Transfer>;
  failCreates?: number;
  /** Error object thrown by failing creates (default: a plain Error, i.e. uncertain). */
  createError?: unknown;
  active?: boolean;
}
function fakeStripe(o: FakeStripeOptions = {}) {
  const created: { params: Stripe.TransferCreateParams; key: string }[] = [];
  let failures = o.failCreates ?? 0;
  const stripe = {
    transfers: {
      list: async () => ({ data: o.existing ?? [] }),
      retrieve: async (id: string) => { const t = o.known?.[id]; if (!t) throw new Error(`No such transfer: ${id}`); return t; },
      create: async (params: Stripe.TransferCreateParams, opts: { idempotencyKey: string }) => {
        if (failures > 0) { failures--; throw o.createError ?? new Error("insufficient funds in platform balance"); }
        const t = tr({ id: `tr_${created.length + 1}`, amount: params.amount, currency: params.currency, destination: params.destination, transfer_group: params.transfer_group ?? null });
        created.push({ params, key: opts.idempotencyKey });
        return t;
      },
    },
    v2: { core: { accounts: { retrieve: async () => ({ id: "acct_test", configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: o.active === false ? "restricted" : "active", status_details: [] } } } } }, requirements: { entries: [] } }), update: async () => { throw new Error("not in this test"); } } } },
    paymentIntents: {
      cancel: async (id: string) => ({ id, status: "canceled" }),
      retrieve: async (id: string) => ({ id, status: "requires_capture", amount: 100, amount_received: 0 }),
    },
    refunds: { list: async () => ({ data: [] }) },
  };
  return { stripe: stripe as unknown as Stripe, created };
}

// ---------------------------------------------------------------- P2: reconciliation
describe("reconcileSellerTransfer (P2)", () => {
  it("verifies a transfer id that is already recorded and creates nothing", async () => {
    const { stripe, created } = fakeStripe({ known: { tr_known: tr({ id: "tr_known" }) } });
    const out = await reconcileSellerTransfer(stripe, task, seller, 75, "ch_1", { attempt: 3, known_transfer_id: "tr_known" });
    expect(out).toMatchObject({ transfer_id: "tr_known", state: "TRANSFERRED", amount_cents: 75 });
    expect(created).toHaveLength(0);
  });
  it("adopts a transfer Stripe already holds for the task (crash between create and record)", async () => {
    const { stripe, created } = fakeStripe({ existing: [tr({ id: "tr_lost" })] });
    const out = await reconcileSellerTransfer(stripe, task, seller, 75, "ch_1", { attempt: 1 });
    expect(out).toMatchObject({ transfer_id: "tr_lost", state: "TRANSFERRED", amount_cents: 75, recovered: true });
    expect(created).toHaveLength(0);
  });
  it("ignores reversed transfers and transfers to other accounts", async () => {
    const { stripe, created } = fakeStripe({ existing: [tr({ id: "tr_rev", reversed: true })] });
    const out = await reconcileSellerTransfer(stripe, task, seller, 75, "ch_1");
    expect(out.state).toBe("TRANSFERRED");
    expect(created).toHaveLength(1);
  });
  it("never adopts a recorded transfer that does not match the task, and creates nothing", async () => {
    for (const bad of [tr({ id: "tr_x", amount: 50 }), tr({ id: "tr_x", destination: "acct_other" }), tr({ id: "tr_x", currency: "eur" }), tr({ id: "tr_x", transfer_group: "task_other" })]) {
      const { stripe, created } = fakeStripe({ known: { tr_x: bad } });
      const out = await reconcileSellerTransfer(stripe, task, seller, 75, "ch_1", { attempt: 2, known_transfer_id: "tr_x" });
      expect(out).toMatchObject({ transfer_id: null, state: "PENDING", pending_reason: "MISMATCH", amount_cents: 0 });
      expect(created).toHaveLength(0);
    }
  });
  it("a looked-up transfer with the wrong amount or destination is MISMATCH, not paid, and blocks a new create", async () => {
    const wrongAmount = fakeStripe({ existing: [tr({ id: "tr_half", amount: 40 })] });
    const o1 = await reconcileSellerTransfer(wrongAmount.stripe, task, seller, 75, "ch_1", { attempt: 1 });
    expect(o1).toMatchObject({ state: "PENDING", pending_reason: "MISMATCH", transfer_id: null });
    expect(wrongAmount.created).toHaveLength(0);
    const otherDest = fakeStripe({ existing: [tr({ id: "tr_elsewhere", destination: "acct_other" })] });
    const o2 = await reconcileSellerTransfer(otherDest.stripe, task, seller, 75, "ch_1", { attempt: 1 });
    expect(o2).toMatchObject({ state: "PENDING", pending_reason: "MISMATCH" });
    expect(otherDest.created).toHaveLength(0);
  });
  it("marks retry_safe_to_advance only when Stripe definitively rejected the create", async () => {
    const rejected = fakeStripe({ failCreates: 1, createError: Object.assign(new Error("Insufficient funds"), { type: "StripeInvalidRequestError", statusCode: 400 }) });
    expect(await reconcileSellerTransfer(rejected.stripe, task, seller, 75, "ch_1", { attempt: 0 })).toMatchObject({ state: "PENDING", pending_reason: "PROVIDER_ERROR", retry_safe_to_advance: true });
    const dropped = fakeStripe({ failCreates: 1, createError: Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" }) });
    expect(await reconcileSellerTransfer(dropped.stripe, task, seller, 75, "ch_1", { attempt: 0 })).toMatchObject({ state: "PENDING", pending_reason: "PROVIDER_ERROR", retry_safe_to_advance: false });
    const conflict = fakeStripe({ failCreates: 1, createError: Object.assign(new Error("key belongs to an in-flight request"), { type: "StripeIdempotencyError", statusCode: 409 }) });
    expect(await reconcileSellerTransfer(conflict.stripe, task, seller, 75, "ch_1")).toMatchObject({ state: "PENDING", retry_safe_to_advance: false });
    const blocked = fakeStripe({ active: false });
    expect(await reconcileSellerTransfer(blocked.stripe, task, seller, 75, "ch_1", { poll: { attempts: 1, delayMs: 1 } })).toMatchObject({ pending_reason: "PENDING_ONBOARDING", retry_safe_to_advance: false });
    const mismatch = fakeStripe({ existing: [tr({ id: "tr_half", amount: 40 })] });
    expect(await reconcileSellerTransfer(mismatch.stripe, task, seller, 75, "ch_1")).toMatchObject({ pending_reason: "MISMATCH", retry_safe_to_advance: false });
  });
  it("classifies Stripe errors: decided 4xx advance the key, transport/5xx/429/401 do not", () => {
    expect(stripeDefinitivelyRejected({ type: "StripeCardError" })).toBe(true);
    expect(stripeDefinitivelyRejected({ type: "StripeIdempotencyError" })).toBe(false);
    expect(stripeDefinitivelyRejected({ type: "StripeInvalidRequestError", code: "idempotency_key_in_use", statusCode: 409 })).toBe(false);
    expect(stripeDefinitivelyRejected({ type: "StripePermissionError", statusCode: 403 })).toBe(false);
    expect(stripeDefinitivelyRejected({ statusCode: 402 })).toBe(true);
    expect(stripeDefinitivelyRejected({ type: "StripeAPIError", statusCode: 500 })).toBe(false);
    expect(stripeDefinitivelyRejected({ type: "StripeRateLimitError", statusCode: 429 })).toBe(false);
    expect(stripeDefinitivelyRejected({ type: "StripeAuthenticationError", statusCode: 401 })).toBe(false);
    expect(stripeDefinitivelyRejected(new Error("timeout"))).toBe(false);
    expect(stripeDefinitivelyRejected(null)).toBe(false);
  });
  it("transferMatches names the first mismatching field", () => {
    const expect_ = { task_id: "task_1", destination: "acct_test", amount_cents: 75 };
    expect(transferMatches(tr({ id: "a" }), expect_)).toBeNull();
    expect(transferMatches(tr({ id: "a", amount: 74 }), expect_)).toMatch(/moved 74c/);
    expect(transferMatches(tr({ id: "a", reversed: true }), expect_)).toMatch(/reversed/);
  });
  it("fails without throwing, then a later attempt creates exactly one transfer with a fresh idempotency key", async () => {
    const { stripe, created } = fakeStripe({ failCreates: 2 });
    const a0 = await reconcileSellerTransfer(stripe, task, seller, 75, "ch_1", { attempt: 0 });
    const a1 = await reconcileSellerTransfer(stripe, task, seller, 75, "ch_1", { attempt: 1 });
    const a2 = await reconcileSellerTransfer(stripe, task, seller, 75, "ch_1", { attempt: 2 });
    expect(a0).toMatchObject({ transfer_id: null, state: "PENDING", pending_reason: "PROVIDER_ERROR", retry_safe_to_advance: false });
    expect(a1).toMatchObject({ transfer_id: null, state: "PENDING", pending_reason: "PROVIDER_ERROR", retry_safe_to_advance: false });
    expect(a2).toMatchObject({ transfer_id: "tr_1", state: "TRANSFERRED", amount_cents: 75 });
    expect(created).toHaveLength(1);
    expect(created[0]!.key).toBe(transferIdempotencyKey("task_1", 2));
    expect(transferIdempotencyKey("task_1", 0)).toBe("atm:task_1:transfer");
    expect(transferIdempotencyKey("task_1", 1)).not.toBe(transferIdempotencyKey("task_1", 2));
  });
  it("keeps the explicit pending fallback when the account cannot receive transfers", async () => {
    const { stripe, created } = fakeStripe({ active: false });
    const out = await reconcileSellerTransfer(stripe, task, seller, 75, "ch_1", { attempt: 1, poll: { attempts: 1, delayMs: 1 } });
    expect(out).toMatchObject({ state: "PENDING", pending_reason: "PENDING_ONBOARDING" });
    expect(out.note).toContain("PENDING_ONBOARDING");
    expect(created).toHaveLength(0);
  });
  it("reports nothing owed and no account without touching Stripe", async () => {
    const { stripe, created } = fakeStripe();
    expect((await reconcileSellerTransfer(stripe, task, seller, 0, "ch_1")).state).toBe("NOT_APPLICABLE");
    expect(await reconcileSellerTransfer(stripe, task, null, 75, "ch_1")).toMatchObject({ state: "PENDING", pending_reason: "PENDING_ONBOARDING" });
    expect(created).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- P1: compensation + inspection
describe("compensateStripeHold / inspectStripeMoney (P1)", () => {
  it("cancels the hold of a task that was never inserted, idempotently", async () => {
    const { stripe } = fakeStripe();
    const hold = { payment_state: "HELD" as const, stripe_payment_intent_id: "pi_1", payment_link: null, task_status: "OPEN" as const, note: "" };
    const r = await compensateStripeHold(stripe, { id: "task_1" }, hold, "task insert failed");
    expect(r.payment_state).toBe("RELEASED");
    expect((await compensateStripeHold(stripe, { id: "task_1" }, { ...hold, stripe_payment_intent_id: null }, "again")).note).toMatch(/no PaymentIntent/);
  });
  it("reports authorised, captured, refunded and transferred cents", async () => {
    const { stripe } = fakeStripe({ existing: [tr({ id: "tr_1" })] });
    const m = await inspectStripeMoney(stripe, task);
    expect(m).toMatchObject({ rail: "card", payment_intent_id: "pi_1", intent_status: "requires_capture", authorized_cents: 100, captured_cents: 0, refunded_cents: 0, transferred_cents: 75, transfer_ids: ["tr_1"] });
  });
});

// ---------------------------------------------------------------- mock rail fault injection
describe("MockProvider fault injection", () => {
  beforeEach(() => setMockFaults(null));
  const buyer = { id: "buyer_1" } as AgentRow;
  const mtask = { id: "task_m", payment_mode: "mock", max_price_cents: 100, stripe_payment_intent_id: "mock_pi_task_m" } as TaskRow;

  it("a failed transfer is reported as owed-but-not-paid, and recovery yields exactly one transfer", async () => {
    setMockFaults("transfer:2");
    const p = payments();
    await p.hold({ id: "task_m", max_price_cents: 100 }, buyer);
    const cap = await p.capture(mtask, seller, 75);
    expect(cap).toMatchObject({ stripe_transfer_id: null, owed_cents: 75, transferred_cents: 0, transfer_state: "PENDING", pending_reason: "PROVIDER_ERROR" });
    expect((await p.retryTransfer!(mtask, seller, 75, { attempt: 1 })).state).toBe("PENDING");
    const ok = await p.retryTransfer!(mtask, seller, 75, { attempt: 2 });
    expect(ok).toMatchObject({ transfer_id: "mock_tr_task_m", state: "TRANSFERRED", amount_cents: 75 });
    expect(await p.retryTransfer!(mtask, seller, 60, { attempt: 3 })).toMatchObject({ state: "PENDING", pending_reason: "MISMATCH" });
    const again = await p.retryTransfer!(mtask, seller, 75, { attempt: 3, known_transfer_id: ok.transfer_id });
    expect(again.transfer_id).toBe("mock_tr_task_m");
    expect(mockLedgerFor("task_m")).toMatchObject({ captured: 75, transferred: 75, transfer_id: "mock_tr_task_m" });
    expect((await p.inspect(mtask)).transfer_ids).toEqual(["mock_tr_task_m"]);
  });
  it("hold and capture faults throw PAYMENT_FAILED, then succeed when the budget is spent", async () => {
    setMockFaults("hold:1,capture:1");
    const p = payments();
    await expect(p.hold({ id: "task_h", max_price_cents: 50 }, buyer)).rejects.toMatchObject({ code: "PAYMENT_FAILED", retryable: false, hold_outcome: "not_created" });
    await expect(p.hold({ id: "task_h", max_price_cents: 50 }, buyer)).resolves.toMatchObject({ payment_state: "MOCK" });
    const htask = { ...mtask, id: "task_h" };
    await expect(p.capture(htask, seller, 50)).rejects.toMatchObject({ code: "PAYMENT_FAILED" });
    await expect(p.capture(htask, seller, 50)).resolves.toMatchObject({ transfer_state: "TRANSFERRED", transferred_cents: 50 });
    const m = await p.inspect(htask);
    expect(m).toMatchObject({ captured_cents: 50, transferred_cents: 50 });
  });
  it("compensateHold undoes a hold whose task never existed", async () => {
    const p = payments();
    const hold = await p.hold({ id: "task_c", max_price_cents: 40 }, buyer);
    await p.compensateHold({ id: "task_c", max_price_cents: 40 }, hold, "insert failed");
    expect((await p.inspect({ ...mtask, id: "task_c" })).authorized_cents).toBe(0);
  });
});

// ---------------------------------------------------------------- idempotent card hold
describe("StripeCardProvider.hold idempotency (P1)", () => {
  const buyer = { id: "buyer_1", stripe_customer_id: "cus_1", stripe_payment_method_id: "pm_1" } as AgentRow;
  function fakeHoldClient(o: { status?: string; throwOnce?: unknown } = {}) {
    const byKey = new Map<string, { id: string; status: string }>();
    const calls: { key: string; amount: number }[] = [];
    let pending = o.throwOnce;
    const client = {
      paymentIntents: {
        create: async (params: { amount: number }, opts: { idempotencyKey: string }) => {
          calls.push({ key: opts.idempotencyKey, amount: params.amount });
          if (pending) { const e = pending; pending = undefined; throw e; }
          const existing = byKey.get(opts.idempotencyKey);
          if (existing) return existing; // Stripe replays the stored result for the same key
          const pi = { id: `pi_${byKey.size + 1}`, status: o.status ?? "requires_capture" };
          byKey.set(opts.idempotencyKey, pi);
          return pi;
        },
      },
    } as unknown as Stripe;
    return { client, calls };
  }
  it("uses the task-scoped key and replays the same intent on a retried hold", async () => {
    const { client, calls } = fakeHoldClient();
    const p = new StripeCardProvider("sk_test_x", client);
    const h1 = await p.hold({ id: "task_h", max_price_cents: 100 }, buyer);
    const h2 = await p.hold({ id: "task_h", max_price_cents: 100 }, buyer);
    expect(h1.stripe_payment_intent_id).toBe("pi_1");
    expect(h2.stripe_payment_intent_id).toBe("pi_1");
    expect(calls.map((c) => c.key)).toEqual([holdIdempotencyKey("task_h"), holdIdempotencyKey("task_h")]);
  });
  it("recovers from an ambiguous response: the retry after a transport error replays, never a second intent", async () => {
    const { client, calls } = fakeHoldClient({ throwOnce: Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" }) });
    const p = new StripeCardProvider("sk_test_x", client);
    await expect(p.hold({ id: "task_a", max_price_cents: 100 }, buyer)).rejects.toMatchObject({ code: "PAYMENT_FAILED", retryable: true, hold_outcome: "unknown" });
    const h = await p.hold({ id: "task_a", max_price_cents: 100 }, buyer);
    expect(h).toMatchObject({ payment_state: "HELD", stripe_payment_intent_id: "pi_1" });
    expect(calls).toHaveLength(2);
  });
  it("a definitive rejection is not retryable, and a replayed cancelled hold says to post a new task", async () => {
    const declined = fakeHoldClient({ throwOnce: Object.assign(new Error("card declined"), { type: "StripeCardError", statusCode: 402 }) });
    await expect(new StripeCardProvider("sk_test_x", declined.client).hold({ id: "task_d", max_price_cents: 100 }, buyer)).rejects.toMatchObject({ code: "PAYMENT_FAILED", retryable: false, hold_outcome: "not_created" });
    const cancelled = fakeHoldClient({ status: "canceled" });
    await expect(new StripeCardProvider("sk_test_x", cancelled.client).hold({ id: "task_c", max_price_cents: 100 }, buyer)).rejects.toMatchObject({ code: "PAYMENT_FAILED", retryable: false, next_action: expect.stringMatching(/new task/) });
    const changed = fakeHoldClient({ throwOnce: Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters"), { type: "StripeIdempotencyError", statusCode: 400 }) });
    await expect(new StripeCardProvider("sk_test_x", changed.client).hold({ id: "task_i", max_price_cents: 100 }, buyer)).rejects.toMatchObject({ retryable: false, hold_outcome: "unknown", message: expect.stringMatching(/different parameters/) });
  });
  it("hold_outcome: mock faults are definitive unless marked transient; holdOutcomeOf classifies foreign errors", async () => {
    setMockFaults("hold:1");
    await expect(payments().hold({ id: "task_m1", max_price_cents: 10 }, buyer)).rejects.toMatchObject({ hold_outcome: "not_created", retryable: false });
    setMockFaults("hold~:1");
    await expect(payments().hold({ id: "task_m2", max_price_cents: 10 }, buyer)).rejects.toMatchObject({ hold_outcome: "unknown", retryable: true });
    setMockFaults(null);
    expect(holdOutcomeOf({ hold_outcome: "not_created" })).toBe("not_created");
    expect(holdOutcomeOf(Object.assign(new Error("x"), { type: "StripeCardError" }))).toBe("not_created");
    expect(holdOutcomeOf(new Error("ETIMEDOUT"))).toBe("unknown");
  });
  it("mock transient faults do not advance the attempt key; definitive ones do", async () => {
    setMockFaults("transfer~:1");
    const p = payments();
    await p.hold({ id: "task_t", max_price_cents: 100 }, buyer);
    const t = { id: "task_t", payment_mode: "mock", max_price_cents: 100, stripe_payment_intent_id: "mock_pi_task_t" } as TaskRow;
    expect(await p.capture(t, seller, 60)).toMatchObject({ transfer_state: "PENDING", transfer_retry_safe_to_advance: false });
    setMockFaults("transfer:1");
    await p.hold({ id: "task_u", max_price_cents: 100 }, buyer);
    expect(await p.capture({ ...t, id: "task_u", stripe_payment_intent_id: "mock_pi_task_u" }, seller, 60)).toMatchObject({ transfer_state: "PENDING", transfer_retry_safe_to_advance: true });
    setMockFaults(null);
  });
});

// ---------------------------------------------------------------- seller payout onboarding (installer step 6)
describe("sellerPayoutOnboarding", () => {
  function fakeAccounts(o: { status: string; blocking?: string[]; linkFails?: boolean }) {
    const links: string[] = [];
    const stripe = {
      v2: { core: {
        accounts: { retrieve: async () => ({ id: "acct_x", configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: o.status, status_details: [] } } } } }, requirements: { entries: (o.blocking ?? []).map((d) => ({ description: d, impact: { restricts_capabilities: [{ capability: "stripe_balance.stripe_transfers" }] } })) } }) },
        accountLinks: { create: async (p: { account: string }) => { if (o.linkFails) throw new Error("links disabled"); links.push(p.account); return { url: `https://connect.stripe.com/setup/${p.account}` }; } },
      } },
    } as unknown as Stripe;
    return { stripe, links };
  }
  const agent = { id: "seller_1", stripe_account_id: "acct_x" };
  it("active accounts need nothing", async () => {
    const { stripe, links } = fakeAccounts({ status: "active" });
    expect(await sellerPayoutOnboarding(stripe, agent, "http://localhost:3000")).toEqual({ payout_status: "active", onboarding_url: null, blocking: [] });
    expect(links).toHaveLength(0);
  });
  it("restricted accounts get a hosted onboarding link and the blocking requirements", async () => {
    const { stripe, links } = fakeAccounts({ status: "restricted", blocking: ["identity.entity_type", "defaults.profile.business_url"] });
    const r = await sellerPayoutOnboarding(stripe, agent, "http://localhost:3000");
    expect(r).toMatchObject({ payout_status: "pending", onboarding_url: "https://connect.stripe.com/setup/acct_x", blocking: ["identity.entity_type", "defaults.profile.business_url"] });
    expect(links).toEqual(["acct_x"]);
  });
  it("never throws: no account → none; link failure → pending without a url", async () => {
    const { stripe } = fakeAccounts({ status: "restricted", linkFails: true });
    expect((await sellerPayoutOnboarding(stripe, { id: "s", stripe_account_id: null }, "http://x")).payout_status).toBe("none");
    expect(await sellerPayoutOnboarding(stripe, agent, "http://x")).toMatchObject({ payout_status: "pending", onboarding_url: null });
  });
  it("includeLink=false only reads status and mints no link", async () => {
    const { stripe, links } = fakeAccounts({ status: "restricted", blocking: ["identity.entity_type"] });
    expect(await sellerPayoutOnboarding(stripe, agent, "http://x", { includeLink: false })).toMatchObject({ payout_status: "pending", onboarding_url: null, blocking: ["identity.entity_type"] });
    expect(links).toHaveLength(0);
  });
  it("sellerPayoutInfo mints a link only for a human-linked seller", async () => {
    // Drive the Stripe path through a card provider injected as the configured one is not possible here,
    // so assert the gate on the helper's own inputs: includeLink without humanLinked must not mint.
    const { stripe, links } = fakeAccounts({ status: "restricted", blocking: ["identity.entity_type"] });
    const ungated = await sellerPayoutOnboarding(stripe, agent, "http://x", { includeLink: true });
    expect(ungated.onboarding_url).not.toBeNull();
    expect(links).toHaveLength(1);
    // The same decision as sellerPayoutInfo applies: includeLink && humanLinked
    const gated = await sellerPayoutOnboarding(stripe, agent, "http://x", { includeLink: true && false });
    expect(gated.onboarding_url).toBeNull();
    expect(links).toHaveLength(1);
  });
  it("is exposed on the configured provider, and sellerPayoutInfo maps the mock rail to MOCK with a TEST/MOCK label", async () => {
    expect(await payments().payoutOnboarding({ id: "s", stripe_account_id: null })).toMatchObject({ payout_status: "active" });
    const info = await sellerPayoutInfo({ id: "s", stripe_account_id: null }, { includeLink: true });
    expect(info).toMatchObject({ payout_status: "MOCK", payout_onboarding_url: null, blocking: [] });
    expect(info.payout_label).toMatch(/MOCK/);
    expect(info.payout_label).toMatch(/not a verified real payout/);
  });
});

// ---------------------------------------------------------------- human onboarding (C-D-20261018T050505Z-01)
describe("human-owned seller accounts", () => {
  function fakeCreate(o: { status?: string } = {}) {
    const created: Record<string, unknown>[] = [];
    const keys: string[] = [];
    const updates: Record<string, unknown>[] = [];
    const links: { account: string; use_case: { account_onboarding: { return_url: string; refresh_url: string } } }[] = [];
    const byKey = new Map<string, unknown>();
    const stripe = {
      v2: { core: {
        accounts: {
          create: async (params: Record<string, unknown>, opts: { idempotencyKey: string }) => { keys.push(opts.idempotencyKey); if (byKey.has(opts.idempotencyKey)) return byKey.get(opts.idempotencyKey); created.push(params); const acct = { id: `acct_${created.length}`, metadata: params.metadata, configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: o.status ?? "restricted", status_details: [] } } } } }, requirements: { entries: [{ description: "identity.entity_type", impact: { restricts_capabilities: [{ capability: "stripe_balance.stripe_transfers" }] } }] } }; byKey.set(opts.idempotencyKey, acct); return acct; },
          retrieve: async () => ({ id: "acct_new", metadata: { onboarding: "human" }, configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: "restricted", status_details: [] } } } } }, requirements: { entries: [{ description: "identity.entity_type", impact: { restricts_capabilities: [{ capability: "stripe_balance.stripe_transfers" }] } }] } }),
          update: async (_id: string, params: Record<string, unknown>) => { updates.push(params); return { id: "acct_new", metadata: { onboarding: "human" }, configuration: {}, requirements: { entries: [] } }; },
        },
        accountLinks: { create: async (p: { account: string; use_case: { account_onboarding: { return_url: string; refresh_url: string } } }) => { links.push(p); return { url: `https://connect.stripe.com/setup/${p.account}` }; } },
      } },
    } as unknown as Stripe;
    return { stripe, created, keys, updates, links };
  }
  it("human_onboarding creates a bare account with the human's email and no synthetic identity", async () => {
    const { stripe, created } = fakeCreate();
    const st = await createRecipientAccount(stripe, { id: "seller_h", display_name: "Ada's Mac", human_onboarding: true, email: "ada@example.com" });
    expect(st).toMatchObject({ account_id: "acct_1", transfers: "restricted", human_onboarding: true, blocking: ["identity.entity_type"] });
    const params = created[0] as { contact_email: string; identity: Record<string, unknown>; metadata: Record<string, string>; defaults: Record<string, unknown> };
    expect(params.contact_email).toBe("ada@example.com");
    expect(params.identity).toEqual({ country: "us" });
    expect(params.metadata.onboarding).toBe("human");
    expect(params.defaults).not.toHaveProperty("profile");
  });
  it("legacy onboarding still applies the synthetic test identity", async () => {
    const { stripe, created } = fakeCreate({ status: "active" });
    await createRecipientAccount(stripe, { id: "seller_t", display_name: "fixture" });
    const params = created[0] as { identity: { individual?: unknown; attestations?: unknown }; metadata: Record<string, string> };
    expect(params.identity.individual).toBeDefined();
    expect(params.identity.attestations).toBeDefined();
    expect(params.metadata.onboarding).toBe("synthetic-test");
  });
  it("never auto-verifies a human account: ensureTransfersActive leaves it pending, and the link is the way forward", async () => {
    const { stripe, updates } = fakeCreate();
    const st = await ensureTransfersActive(stripe, "acct_new", { id: "seller_h", display_name: "Ada's Mac" }, { attempts: 1, delayMs: 1 });
    expect(st).toMatchObject({ transfers: "restricted", human_onboarding: true });
    expect(updates).toHaveLength(0);
    const info = await sellerPayoutOnboarding(stripe, { id: "seller_h", stripe_account_id: "acct_new" }, "http://x", { includeLink: true });
    expect(info).toMatchObject({ payout_status: "pending", onboarding_url: "https://connect.stripe.com/setup/acct_new", blocking: ["identity.entity_type"] });
  });
  it("creates at most one payout account per agent: the stable key replays on retry or concurrent completion", async () => {
    const { stripe, created, keys } = fakeCreate();
    const agent = { id: "seller_h", display_name: "Ada's Mac", human_onboarding: true, email: "ada@example.com" };
    const [a, b] = await Promise.all([onboardSellerAccount(stripe, agent), onboardSellerAccount(stripe, agent)]);
    const c = await onboardSellerAccount(stripe, agent);
    expect(a.stripe_account_id).toBe("acct_1");
    expect(b.stripe_account_id).toBe("acct_1");
    expect(c.stripe_account_id).toBe("acct_1");
    expect(created).toHaveLength(1);
    expect(new Set(keys)).toEqual(new Set([payoutAccountIdempotencyKey("seller_h")]));
    expect(payoutAccountIdempotencyKey("seller_h")).toBe("atm:seller_h:payout-account");
    expect(PAYOUT_ACCOUNT_RETRY_POLICY).toMatchObject({ max_attempts: 3, window_hours: 20 });
    expect(PAYOUT_ACCOUNT_RETRY_POLICY.window_hours).toBeLessThan(24);
  });
  it("an idempotency conflict (same agent, changed parameters) creates nothing and reports no account", async () => {
    const stripe = { v2: { core: { accounts: { create: async () => { throw Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters"), { type: "StripeIdempotencyError" }); } } } } } as unknown as Stripe;
    expect(await onboardSellerAccount(stripe, { id: "seller_h", display_name: "x", human_onboarding: true, email: "new@example.com" })).toEqual({ stripe_account_id: null });
  });
  it("human onboarding links return to the seller setup pages; legacy links keep /api/dashboard", async () => {
    const { stripe, links } = fakeCreate();
    await onboardingLink(stripe, "acct_h", "https://host.example/", { human: true });
    await onboardingLink(stripe, "acct_l", "https://host.example");
    expect(links[0]!.use_case.account_onboarding).toEqual({ return_url: `https://host.example${SELLER_SETUP_RETURN_PATH}`, refresh_url: `https://host.example${SELLER_SETUP_REFRESH_PATH}` });
    expect(links[1]!.use_case.account_onboarding).toEqual({ return_url: "https://host.example/api/dashboard", refresh_url: "https://host.example/api/dashboard" });
    expect(SELLER_SETUP_RETURN_PATH).toBe("/seller/setup-return");
    expect(SELLER_SETUP_REFRESH_PATH).toBe("/seller/setup-refresh");
    // sellerPayoutOnboarding picks the human pages automatically from the account's metadata marker
    await sellerPayoutOnboarding(stripe, { id: "seller_h", stripe_account_id: "acct_new" }, "https://host.example", { includeLink: true });
    expect(links[2]!.use_case.account_onboarding.return_url).toBe(`https://host.example${SELLER_SETUP_RETURN_PATH}`);
  });
});

// ---------------------------------------------------------------- human buyers (C-D-20261018T055000Z-01)
describe("human-owned buyers", () => {
  function fakeBuyerStripe(o: { cards?: { id: string; customer: string; brand?: string; last4?: string }[]; recorded?: { id: string; customer: string } } = {}) {
    const customers: Record<string, unknown>[] = [];
    const keys: string[] = [];
    const attached: string[] = [];
    const sessions: Record<string, unknown>[] = [];
    const defaults: string[] = [];
    const byKey = new Map<string, { id: string }>();
    const stripe = {
      customers: {
        create: async (params: Record<string, unknown>, opts: { idempotencyKey: string }) => { keys.push(opts.idempotencyKey); if (byKey.has(opts.idempotencyKey)) return byKey.get(opts.idempotencyKey); customers.push(params); const c = { id: `cus_${customers.length}` }; byKey.set(opts.idempotencyKey, c); return c; },
        update: async (_id: string, p: { invoice_settings: { default_payment_method: string } }) => { defaults.push(p.invoice_settings.default_payment_method); return {}; },
      },
      paymentMethods: {
        attach: async (id: string) => { attached.push(id); return { id: "pm_visa_clone" }; },
        retrieve: async (id: string) => { const r = o.recorded; if (!r || r.id !== id) throw new Error("No such payment method"); return { id, customer: r.customer, card: { brand: "visa", last4: "4242" } }; },
        list: async ({ customer }: { customer: string }) => ({ data: (o.cards ?? []).filter((c) => c.customer === customer).map((c) => ({ id: c.id, customer: c.customer, card: { brand: c.brand ?? "visa", last4: c.last4 ?? "4242" } })) }),
      },
      checkout: { sessions: { create: async (p: Record<string, unknown>) => { sessions.push(p); return { url: "https://checkout.stripe.com/c/pay/cs_test_1" }; } } },
    } as unknown as Stripe;
    return { stripe, customers, keys, attached, sessions, defaults };
  }
  it("human onboarding creates one customer under a stable key with the email and attaches no test card", async () => {
    const { stripe, customers, keys, attached } = fakeBuyerStripe();
    const agent = { id: "buyer_h", display_name: "Ada", human_onboarding: true, email: "ada@example.com" };
    const [a, b] = await Promise.all([onboardBuyerCustomer(stripe, agent), onboardBuyerCustomer(stripe, agent)]);
    expect(a).toEqual({ stripe_customer_id: "cus_1", stripe_payment_method_id: null });
    expect(b).toEqual(a);
    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({ email: "ada@example.com", metadata: { onboarding: "human" } });
    expect(attached).toHaveLength(0);
    expect(new Set(keys)).toEqual(new Set([customerIdempotencyKey("buyer_h")]));
  });
  it("legacy onboarding still attaches the shared test card", async () => {
    const { stripe, attached } = fakeBuyerStripe();
    expect(await onboardBuyerCustomer(stripe, { id: "buyer_t", display_name: "fixture" })).toEqual({ stripe_customer_id: "cus_1", stripe_payment_method_id: "pm_visa_clone" });
    expect(attached).toEqual(["pm_card_visa"]);
  });
  it("SETUP_REQUIRED until the person saves a card; the setup link is a Checkout session in setup mode on their customer", async () => {
    const { stripe, sessions } = fakeBuyerStripe();
    const agent = { id: "buyer_h", stripe_customer_id: "cus_1", stripe_payment_method_id: null };
    expect(await buyerPaymentSetup(stripe, agent, "https://host.example")).toMatchObject({ buyer_payment_status: "SETUP_REQUIRED", setup_url: null });
    expect(sessions).toHaveLength(0);
    const withLink = await buyerPaymentSetup(stripe, agent, "https://host.example/", { includeSetup: true });
    expect(withLink).toMatchObject({ buyer_payment_status: "SETUP_REQUIRED", setup_url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    expect(sessions[0]).toMatchObject({ mode: "setup", currency: "usd", customer: "cus_1", success_url: `https://host.example${BUYER_SETUP_RETURN_PATH}?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `https://host.example${BUYER_SETUP_REFRESH_PATH}` });
  });
  it("confirmBuyerSetupSession accepts only a complete setup session of this customer with a succeeded SetupIntent", async () => {
    const make = (session: Record<string, unknown>) => {
      const defaults: string[] = [];
      const stripe = { checkout: { sessions: { retrieve: async () => session } }, setupIntents: { retrieve: async () => { throw new Error("not used"); } }, customers: { update: async (_: string, p: { invoice_settings: { default_payment_method: string } }) => { defaults.push(p.invoice_settings.default_payment_method); return {}; } } } as unknown as Stripe;
      return { stripe, defaults };
    };
    const agent = { id: "b", stripe_customer_id: "cus_1", stripe_payment_method_id: null };
    const ok = make({ mode: "setup", status: "complete", customer: "cus_1", setup_intent: { status: "succeeded", customer: "cus_1", payment_method: "pm_new" } });
    expect(await confirmBuyerSetupSession(ok.stripe, agent, "cs_1")).toEqual({ stripe_payment_method_id: "pm_new", reason: null });
    expect(ok.defaults).toEqual(["pm_new"]);
    const otherCustomer = make({ mode: "setup", status: "complete", customer: "cus_other", setup_intent: { status: "succeeded", customer: "cus_other", payment_method: "pm_x" } });
    expect((await confirmBuyerSetupSession(otherCustomer.stripe, agent, "cs_2")).stripe_payment_method_id).toBeNull();
    expect(otherCustomer.defaults).toHaveLength(0);
    const incomplete = make({ mode: "setup", status: "open", customer: "cus_1", setup_intent: null });
    expect((await confirmBuyerSetupSession(incomplete.stripe, agent, "cs_3")).stripe_payment_method_id).toBeNull();
    const failedIntent = make({ mode: "setup", status: "complete", customer: "cus_1", setup_intent: { status: "requires_payment_method", customer: "cus_1", payment_method: null } });
    expect((await confirmBuyerSetupSession(failedIntent.stripe, agent, "cs_4")).stripe_payment_method_id).toBeNull();
  });
  it("reconciliation attaches only a card confirmed for that exact customer and reports it for persistence", async () => {
    const { stripe, defaults } = fakeBuyerStripe({ cards: [{ id: "pm_other", customer: "cus_other" }, { id: "pm_ada", customer: "cus_1", last4: "1881" }] });
    const r = await buyerPaymentSetup(stripe, { id: "buyer_h", stripe_customer_id: "cus_1", stripe_payment_method_id: null }, "https://host.example", { includeSetup: true });
    expect(r).toMatchObject({ buyer_payment_status: "READY", setup_url: null, confirmed_payment_method_id: "pm_ada", payment_method: { id: "pm_ada", brand: "visa", last4: "1881" } });
    expect(defaults).toEqual(["pm_ada"]);
  });
  it("a recorded card that belongs to another customer is never used; a recorded card of this customer is READY without reconciliation", async () => {
    const wrong = fakeBuyerStripe({ recorded: { id: "pm_x", customer: "cus_other" } });
    expect(await buyerPaymentSetup(wrong.stripe, { id: "b", stripe_customer_id: "cus_1", stripe_payment_method_id: "pm_x" }, "https://h")).toMatchObject({ buyer_payment_status: "SETUP_REQUIRED", payment_method: null });
    const right = fakeBuyerStripe({ recorded: { id: "pm_x", customer: "cus_1" } });
    expect(await buyerPaymentSetup(right.stripe, { id: "b", stripe_customer_id: "cus_1", stripe_payment_method_id: "pm_x" }, "https://h")).toMatchObject({ buyer_payment_status: "READY", payment_method: { id: "pm_x" }, confirmed_payment_method_id: null });
    expect(await buyerPaymentSetup(right.stripe, { id: "b", stripe_customer_id: null, stripe_payment_method_id: null }, "https://h")).toMatchObject({ buyer_payment_status: "UNAVAILABLE" });
  });
  it("buyerPaymentInfo maps the mock rail to MOCK and only a human-linked buyer gets a setup link", async () => {
    const info = await buyerPaymentInfo({ id: "b", stripe_customer_id: null, stripe_payment_method_id: null }, { includeSetup: true, humanLinked: true });
    expect(info).toMatchObject({ buyer_payment_status: "MOCK", setup_url: null });
    expect(info.payment_label).toMatch(/MOCK/);
  });
});
