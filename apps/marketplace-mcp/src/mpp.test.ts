import { describe, expect, it, vi } from "vitest";
import type { TaskRow } from "./db.js";
import { StripeMppProvider, assertTestMoney, markTaskPaid } from "./mpp.js";
import { db, one, unwrap, type AgentRow, type JobRow } from "./db.js";
import * as svc from "./service.js";

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

// ---------------------------------------------------------------- keyed buyer + job reserve on payment (P1/F1)
describe("markTaskPaid reserves against the buyer cap and the job budget with keys", () => {
  async function seed(opts: { cap: number; budget: number; max: number; id: string; jobId?: string }) {
    const { agent } = await svc.registerAgent({ kind: "buyer", display_name: "mpp-buyer", spend_cap_cents: opts.cap });
    const jobId = opts.jobId ?? (await svc.createJob(agent, { budget_cents: opts.budget })).job.job_id;
    unwrap(await db().from("tasks").insert({
      id: opts.id, buyer_id: agent.id, allowed_models: ["qwen3:8b"], max_price_cents: opts.max, max_runtime_s: 180, status: "AWAITING_PAYMENT",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(), payment_mode: "mpp", payment_state: "AWAITING_PAYMENT", claim_count: 0, job_id: jobId,
    }));
    const task = (await one<TaskRow>(await db().from("tasks").select("*").eq("id", opts.id).limit(1)))!;
    return { agent, jobId, task };
  }
  const buyerRow = async (id: string) => (await one<AgentRow>(await db().from("agents").select("*").eq("id", id).limit(1)))!;
  const jobRow = async (id: string) => (await one<JobRow>(await db().from("jobs").select("*").eq("id", id).limit(1)))!;

  it("opens the task, reserves the offer on buyer and job once, and is a no-op on a replayed payment", async () => {
    const { agent, jobId, task } = await seed({ cap: 100, budget: 60, max: 55, id: "task_paid_1" });
    const opened = await markTaskPaid(task, "pi_paid_1");
    expect(opened).toMatchObject({ status: "OPEN", payment_state: "PAID", stripe_payment_intent_id: "pi_paid_1" });
    expect(await buyerRow(agent.id)).toMatchObject({ reserved_cents: 55, balance_keys: expect.arrayContaining(["paid:task_paid_1:pi_paid_1"]) });
    expect(await jobRow(jobId)).toMatchObject({ reserved_cents: 55, balance_keys: expect.arrayContaining(["paid:task_paid_1:pi_paid_1"]) });
    const again = await markTaskPaid(task, "pi_paid_1");
    expect(again.stripe_payment_intent_id).toBe("pi_paid_1");
    expect((await buyerRow(agent.id)).reserved_cents).toBe(55);
    expect((await jobRow(jobId)).reserved_cents).toBe(55);
  });
  it("refuses over the job budget, compensates the buyer reservation and leaves the task unpaid", async () => {
    const { agent, jobId, task } = await seed({ cap: 500, budget: 50, max: 55, id: "task_paid_2" });
    await expect(markTaskPaid(task, "pi_paid_2")).rejects.toMatchObject({ code: "JOB_BUDGET_EXCEEDED" });
    expect((await buyerRow(agent.id)).reserved_cents).toBe(0);
    expect((await jobRow(jobId)).reserved_cents).toBe(0);
    expect((await one<TaskRow>(await db().from("tasks").select("*").eq("id", "task_paid_2").limit(1)))!.status).toBe("AWAITING_PAYMENT");
  });
  it("refuses over the buyer cap before touching the job", async () => {
    const { agent, jobId, task } = await seed({ cap: 50, budget: 50, max: 55, id: "task_paid_3" });
    await expect(markTaskPaid(task, "pi_paid_3")).rejects.toMatchObject({ code: "SPEND_CAP_EXCEEDED" });
    expect((await buyerRow(agent.id)).reserved_cents).toBe(0);
    expect((await jobRow(jobId)).reserved_cents).toBe(0);
  });
  it("a compensated failed open cannot reopen the task on the consumed key; a new payment reserves afresh", async () => {
    const { agent, jobId, task } = await seed({ cap: 500, budget: 200, max: 55, id: "task_paid_4" });
    // Make the open fail: the task leaves AWAITING_PAYMENT under our feet (e.g. cancelled), then comes back.
    unwrap(await db().from("tasks").update({ status: "CANCELLED" }).eq("id", task.id));
    await expect(markTaskPaid(task, "pi_first")).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await buyerRow(agent.id)).reserved_cents).toBe(0);
    expect((await jobRow(jobId)).reserved_cents).toBe(0);
    unwrap(await db().from("tasks").update({ status: "AWAITING_PAYMENT" }).eq("id", task.id));
    // Replaying the refunded payment must not open the task with no reservation.
    await expect(markTaskPaid(task, "pi_first")).rejects.toMatchObject({ code: "INVALID_STATE", message: expect.stringMatching(/already refunded/) });
    expect((await one<TaskRow>(await db().from("tasks").select("*").eq("id", task.id).limit(1)))!.status).toBe("AWAITING_PAYMENT");
    expect((await buyerRow(agent.id)).reserved_cents).toBe(0);
    // A new payment gets its own key and a real reservation.
    expect(await markTaskPaid(task, "pi_second")).toMatchObject({ status: "OPEN", stripe_payment_intent_id: "pi_second" });
    expect((await buyerRow(agent.id)).reserved_cents).toBe(55);
    expect((await jobRow(jobId)).reserved_cents).toBe(55);
  });
  it("two concurrent payments with different intents: one wins, the loser gives back only its own reservation", async () => {
    const { agent, jobId, task } = await seed({ cap: 500, budget: 200, max: 55, id: "task_paid_5" });
    const results = await Promise.all([markTaskPaid(task, "pi_A"), markTaskPaid(task, "pi_B")].map((p) => p.then((r) => ({ ok: r }), (e) => ({ err: e as Error }))));
    const wins = results.filter((r) => "ok" in r);
    const losses = results.filter((r) => "err" in r);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect((losses[0] as unknown as { err: { code: string } }).err.code).toBe("INVALID_STATE");
    const current = (await one<TaskRow>(await db().from("tasks").select("*").eq("id", task.id).limit(1)))!;
    expect(current.status).toBe("OPEN");
    expect(["pi_A", "pi_B"]).toContain(current.stripe_payment_intent_id);
    // Exactly one reservation survives, on both ledgers, and it belongs to the winner.
    expect((await buyerRow(agent.id)).reserved_cents).toBe(55);
    expect((await jobRow(jobId)).reserved_cents).toBe(55);
    expect((await buyerRow(agent.id)).balance_keys).toEqual(expect.arrayContaining([`paid:task_paid_5:${current.stripe_payment_intent_id}`]));
    // Replaying the winner is a no-op; replaying the loser is refused without touching the ledger.
    expect((await markTaskPaid(task, current.stripe_payment_intent_id!)).stripe_payment_intent_id).toBe(current.stripe_payment_intent_id);
    const loserId = current.stripe_payment_intent_id === "pi_A" ? "pi_B" : "pi_A";
    await expect(markTaskPaid(task, loserId)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await buyerRow(agent.id)).reserved_cents).toBe(55);
  });
});
