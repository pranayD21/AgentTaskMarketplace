import { beforeEach, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import type { AgentRow, TaskRow } from "./db.js";
import { compensateStripeHold, inspectStripeMoney, mockLedgerFor, payments, reconcileSellerTransfer, setMockFaults, transferIdempotencyKey } from "./payments.js";

// ---------------------------------------------------------------- fakes
const seller = { id: "seller_1", stripe_account_id: "acct_test" } as AgentRow;
const task = { id: "task_1", payment_mode: "card", max_price_cents: 100, stripe_payment_intent_id: "pi_1" } as TaskRow;

interface FakeStripeOptions {
  existing?: Stripe.Transfer[];
  known?: Record<string, Stripe.Transfer>;
  failCreates?: number;
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
        if (failures > 0) { failures--; throw new Error("insufficient funds in platform balance"); }
        const t = { id: `tr_${created.length + 1}`, amount: params.amount, destination: params.destination, reversed: false } as Stripe.Transfer;
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
    const { stripe, created } = fakeStripe({ known: { tr_known: { id: "tr_known", amount: 75, reversed: false } as Stripe.Transfer } });
    const out = await reconcileSellerTransfer(stripe, task, seller, 75, "ch_1", { attempt: 3, known_transfer_id: "tr_known" });
    expect(out).toMatchObject({ transfer_id: "tr_known", state: "TRANSFERRED" });
    expect(created).toHaveLength(0);
  });
  it("adopts a transfer Stripe already holds for the task (crash between create and record)", async () => {
    const { stripe, created } = fakeStripe({ existing: [{ id: "tr_lost", amount: 75, destination: "acct_test", reversed: false } as Stripe.Transfer] });
    const out = await reconcileSellerTransfer(stripe, task, seller, 75, "ch_1", { attempt: 1 });
    expect(out).toMatchObject({ transfer_id: "tr_lost", state: "TRANSFERRED", recovered: true });
    expect(created).toHaveLength(0);
  });
  it("ignores reversed transfers and transfers to other accounts", async () => {
    const { stripe, created } = fakeStripe({ existing: [
      { id: "tr_rev", amount: 75, destination: "acct_test", reversed: true } as Stripe.Transfer,
      { id: "tr_other", amount: 75, destination: "acct_other", reversed: false } as Stripe.Transfer,
    ] });
    const out = await reconcileSellerTransfer(stripe, task, seller, 75, "ch_1");
    expect(out.state).toBe("TRANSFERRED");
    expect(created).toHaveLength(1);
  });
  it("fails without throwing, then a later attempt creates exactly one transfer with a fresh idempotency key", async () => {
    const { stripe, created } = fakeStripe({ failCreates: 2 });
    const a0 = await reconcileSellerTransfer(stripe, task, seller, 75, "ch_1", { attempt: 0 });
    const a1 = await reconcileSellerTransfer(stripe, task, seller, 75, "ch_1", { attempt: 1 });
    const a2 = await reconcileSellerTransfer(stripe, task, seller, 75, "ch_1", { attempt: 2 });
    expect(a0).toMatchObject({ transfer_id: null, state: "FAILED" });
    expect(a1).toMatchObject({ transfer_id: null, state: "FAILED" });
    expect(a2).toMatchObject({ transfer_id: "tr_1", state: "TRANSFERRED" });
    expect(created).toHaveLength(1);
    expect(created[0]!.key).toBe(transferIdempotencyKey("task_1", 2));
    expect(transferIdempotencyKey("task_1", 0)).toBe("atm:task_1:transfer");
    expect(transferIdempotencyKey("task_1", 1)).not.toBe(transferIdempotencyKey("task_1", 2));
  });
  it("keeps the explicit pending fallback when the account cannot receive transfers", async () => {
    const { stripe, created } = fakeStripe({ active: false });
    const out = await reconcileSellerTransfer(stripe, task, seller, 75, "ch_1", { attempt: 1, poll: { attempts: 1, delayMs: 1 } });
    expect(out.state).toBe("PENDING_ONBOARDING");
    expect(out.note).toContain("PENDING_ONBOARDING");
    expect(created).toHaveLength(0);
  });
  it("reports nothing owed and no account without touching Stripe", async () => {
    const { stripe, created } = fakeStripe();
    expect((await reconcileSellerTransfer(stripe, task, seller, 0, "ch_1")).state).toBe("NOT_APPLICABLE");
    expect((await reconcileSellerTransfer(stripe, task, null, 75, "ch_1")).state).toBe("PENDING_ONBOARDING");
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
    const { stripe } = fakeStripe({ existing: [{ id: "tr_1", amount: 75, destination: "acct_test", reversed: false } as Stripe.Transfer] });
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
    expect(cap).toMatchObject({ stripe_transfer_id: null, owed_cents: 75, transferred_cents: 0, transfer_state: "FAILED" });
    const settlement = { seller_payout_cents: 75, stripe_capture_id: cap.stripe_capture_id, stripe_transfer_id: null };
    expect((await p.retryTransfer(mtask, seller, settlement, 1)).state).toBe("FAILED");
    const ok = await p.retryTransfer(mtask, seller, settlement, 2);
    expect(ok).toMatchObject({ transfer_id: "mock_tr_task_m", state: "TRANSFERRED" });
    const again = await p.retryTransfer(mtask, seller, { ...settlement, stripe_transfer_id: ok.transfer_id }, 3);
    expect(again.transfer_id).toBe("mock_tr_task_m");
    expect(mockLedgerFor("task_m")).toMatchObject({ captured: 75, transferred: 75, transfer_id: "mock_tr_task_m" });
    expect((await p.inspect(mtask)).transfer_ids).toEqual(["mock_tr_task_m"]);
  });
  it("hold and capture faults throw retryable PAYMENT_FAILED, then succeed when the budget is spent", async () => {
    setMockFaults("hold:1,capture:1");
    const p = payments();
    await expect(p.hold({ id: "task_h", max_price_cents: 50 }, buyer)).rejects.toMatchObject({ code: "PAYMENT_FAILED", retryable: true });
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
