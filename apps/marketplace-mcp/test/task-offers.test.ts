import { describe, expect, it } from "vitest";
import { generateKeypair, toB64 } from "@atm/crypto";
import { ModelInfo } from "@atm/shared";
import { db, unwrap } from "../src/db.ts";
import * as svc from "../src/service.ts";
import { agent, expectError, post, runCycle, seller } from "./helpers.ts";

const key = () => ({ runner_pubkey_b64: toB64(generateKeypair().publicKey) });
describe("task offers", () => {
  it("accepts quote-free registrations and ignores even a larger legacy ask", async () => {
    expect(ModelInfo.parse({ model_id: "qwen3:8b" })).not.toHaveProperty("ask_cents");
    const b = await agent("buyer"), s = await seller(9999);
    expect((await svc.sellerReputation(s.id)).models[0]).not.toHaveProperty("ask_cents");
    const t = await post(b, { price_cents: 125, max_price_cents: undefined });
    expect(t.price_cents).toBe(125);
    expect((await svc.listOpenTasksFor(s)).tasks.find((v) => v.task_id === t.task_id)?.eligible_models).toContain("qwen3:8b");
    expect((await svc.claimTask(s, t.task_id, "qwen3:8b", key())).price_cents).toBe(125);
  });
  it("rejects conflicting, missing, fractional or unsafe offers without a hold or reservation", async () => {
    const b = await agent("buyer");
    for (const fields of [{ price_cents: 100, max_price_cents: 99 }, { price_cents: 1.5, max_price_cents: undefined }, { price_cents: NaN, max_price_cents: undefined }, { price_cents: undefined, max_price_cents: undefined }]) {
      await expectError(post(b, fields), "VALIDATION_ERROR");
    }
    expect(await svc.getAgent(b.id)).toMatchObject({ reserved_cents: 0, spent_cents: 0 });
  });
  it("preserves a legacy accepted price through release and settlement", async () => {
    const b = await agent("buyer"), s = await seller(), j = await agent("judge");
    const t = await post(b);
    // Simulate an already accepted pre-migration claim at 60c within a 100c hold.
    const first = await svc.claimTask(s, t.task_id, "qwen3:8b", key());
    unwrap(await db().from("tasks").update({ price_cents: 60, pricing_mode: null }).eq("id", t.task_id));
    await svc.releaseTask(s, t.task_id, first.claim_id, "fixture");
    const { claim, submitted } = await runCycle(s, t.task_id);
    expect(claim.price_cents).toBe(60);
    const done = await svc.submitVerdict(j, { task_id: t.task_id, result_id: submitted.result_id, verdict: "APPROVE", reason_code: "RUBRIC_MATCH" });
    expect(done.settlement).toMatchObject({ seller_payout_cents: 60, buyer_refund_cents: 40 });
    expect(await svc.getAgent(b.id)).toMatchObject({ reserved_cents: 0, spent_cents: 60 });
  });
  it("one of two sellers wins the claim and the posted price stays fixed", async () => {
    const b = await agent("buyer"), x = await seller(1), y = await seller(900);
    const t = await post(b, { price_cents: 140, max_price_cents: 140 });
    const out = await Promise.allSettled([svc.claimTask(x, t.task_id, "qwen3:8b", key()), svc.claimTask(y, t.task_id, "qwen3:8b", key())]);
    const won = out.filter((r) => r.status === "fulfilled");
    expect(won).toHaveLength(1);
    expect(won[0]!.value.price_cents).toBe(140);
    expect((await svc.getTask(t.task_id))!.price_cents).toBe(140);
  });
  it("returns bounded metadata observations with honest sample coverage", async () => {
    const b = await agent("buyer");
    const t = await post(b, { max_runtime_s: 137 });
    const out = await svc.marketPriceObservations();
    const group = out.groups.find((g) => g.max_runtime_s === 137)!;
    expect(group).toMatchObject({ sample_count: 1, accepted_count: 0, sample_status: "insufficient_data", fill_time_sample_count: 0, claim_rate: 0, posted_price_cents: { median: 100 } });
    expect(JSON.stringify(out)).not.toContain("capital of Peru");
    expect(out.limitation).toContain("do not establish market equilibrium");
    await svc.cancelTask(b, t.task_id);
  });
});
