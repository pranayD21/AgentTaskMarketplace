import { describe, expect, it } from "vitest";
import { StripeMppProvider, assertTestMoney } from "./mpp.js";

// Pure construction-time checks; no network. End-to-end MPP tests need a
// running server and Stripe test mode: see docs/payments/README.md.
describe("StripeMppProvider", () => {
  it("refuses a non-test Stripe key", () => {
    expect(() => new StripeMppProvider("sk_live_123", "profile_test_x", "http://localhost:3000")).toThrow(/test-mode/);
  });
  it("needs the Business Network profile id", () => {
    expect(() => new StripeMppProvider("sk_test_123", undefined, "http://localhost:3000")).toThrow(/STRIPE_PROFILE_ID/);
  });
  it("builds payment links under /api/pay and posts tasks as AWAITING_PAYMENT", async () => {
    const p = new StripeMppProvider("sk_test_123", "profile_test_x", "http://localhost:3000/");
    expect(p.paymentLink("task_abc")).toBe("http://localhost:3000/api/pay/task_abc");
    const hold = await p.hold({ id: "task_abc", max_price_cents: 100 });
    expect(hold).toMatchObject({ payment_state: "AWAITING_PAYMENT", task_status: "AWAITING_PAYMENT", stripe_payment_intent_id: null, payment_link: "http://localhost:3000/api/pay/task_abc" });
    expect(hold.note).toMatch(/402/);
  });
});

describe("assertTestMoney", () => {
  const stripeWith = (pi: Record<string, unknown>) => ({ paymentIntents: { retrieve: async () => ({ id: "pi_x", ...pi }) } }) as never;
  it("accepts a test-mode usd intent at or under the task max", async () => {
    await expect(assertTestMoney(stripeWith({ livemode: false, currency: "usd", amount: 55 }), "pi_x", 55)).resolves.toBeUndefined();
  });
  it("refuses live mode", async () => {
    await expect(assertTestMoney(stripeWith({ livemode: true, currency: "usd", amount: 55 }), "pi_x", 55)).rejects.toThrow(/LIVE MODE/);
  });
  it("refuses more than the task max or another currency", async () => {
    await expect(assertTestMoney(stripeWith({ livemode: false, currency: "usd", amount: 56 }), "pi_x", 55)).rejects.toThrow(/expected at most/);
    await expect(assertTestMoney(stripeWith({ livemode: false, currency: "eur", amount: 55 }), "pi_x", 55)).rejects.toThrow(/expected at most/);
  });
});
