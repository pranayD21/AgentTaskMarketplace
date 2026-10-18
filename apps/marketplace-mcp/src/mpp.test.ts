import { describe, expect, it, vi } from "vitest";
import type { TaskRow } from "./db.js";
import { StripeMppProvider } from "./mpp.js";

// Pure construction-time checks; no network. End-to-end MPP tests need a
// running server and Stripe test mode: see docs/payments/README.md.
describe("StripeMppProvider", () => {
  it("refuses a non-test Stripe key", () => {
    expect(() => new StripeMppProvider("sk_live_123", "profile_test_x", "http://localhost:3000")).toThrow(/test-mode/);
  });
  it("needs the Business Network profile id", () => {
    expect(() => new StripeMppProvider("sk_test_123", undefined, "http://localhost:3000")).toThrow(/STRIPE_PROFILE_ID/);
  });
  it("does not report a failed refund as RELEASED", async () => {
    const p = new StripeMppProvider("sk_test_123", "profile_test_x", "http://localhost:3000");
    vi.spyOn(p.stripe.refunds, "create").mockRejectedValue(new Error("provider unavailable"));
    await expect(p.release({ id: "task_refund", stripe_payment_intent_id: "pi_test" } as TaskRow, "test cancellation"))
      .rejects.toMatchObject({ code: "PAYMENT_FAILED", retryable: true });
  });

  it("builds payment links under /api/pay and posts tasks as AWAITING_PAYMENT", async () => {
    const p = new StripeMppProvider("sk_test_123", "profile_test_x", "http://localhost:3000/");
    expect(p.paymentLink("task_abc")).toBe("http://localhost:3000/api/pay/task_abc");
    const hold = await p.hold({ id: "task_abc", max_price_cents: 100 });
    expect(hold).toMatchObject({ payment_state: "AWAITING_PAYMENT", task_status: "AWAITING_PAYMENT", stripe_payment_intent_id: null, payment_link: "http://localhost:3000/api/pay/task_abc" });
    expect(hold.note).toMatch(/402/);
  });
});
