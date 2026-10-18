/**
 * Contract v0.3 §10 (F1 jobs and parts, V1 ambiguous posts), §11 (B1 usage
 * records), §12 (I1 Inkbox continuity) and schema/migration consistency.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeypair, openJson, toB64 } from "@atm/crypto";
import { UsageRecord, type SellerPayload } from "@atm/shared";
import { SCHEMA_PATCHES, db, unwrap } from "../src/db.ts";
import { inkbox } from "../src/inkbox.ts";
import { payments } from "../src/payments.ts";
import * as svc from "../src/service.ts";
import { agent, expectError, post, runCycle, seller, taskRow } from "./helpers.ts";

afterEach(() => vi.restoreAllMocks());

const PROMPT_A = "PART-A-SECRET: summarise the first half.";
const PROMPT_B = "PART-B-SECRET: summarise the second half.";

async function judgeAll(judge: Awaited<ReturnType<typeof agent>>, verdicts: Record<string, "APPROVE" | "REJECT">) {
  for (const [taskId, verdict] of Object.entries(verdicts)) {
    const res = unwrap(await db().from("results").select("id").eq("task_id", taskId).order("created_at", { ascending: false }).limit(1)) as { id: string }[];
    await svc.submitVerdict(judge, { task_id: taskId, result_id: res[0]!.id, verdict, reason_code: verdict === "APPROVE" ? "RUBRIC_MATCH" : "RUBRIC_MISMATCH" });
  }
}

describe("F1: a job split into parts", () => {
  it("runs two parts on two different sellers without leaking prompts, then completes within budget", async () => {
    const buyer = await agent("buyer");
    const judge = await agent("judge");
    const { job } = await svc.createJob(buyer, { budget_cents: 200, label_public: "two halves" });
    expect(job).toMatchObject({ status: "EMPTY", budget_cents: 200, reserved_cents: 0 });

    const a = await post(buyer, { prompt: PROMPT_A, job_id: job.job_id, part_key: "part-a", part_label: "first half" });
    const b = await post(buyer, { prompt: PROMPT_B, job_id: job.job_id, part_key: "part-b", part_label: "second half" });
    expect(a).toMatchObject({ job_id: job.job_id, part_key: "part-a", attempt: 1 });

    // Two distinct sellers, each with its own per-claim key.
    const [s1, s2] = [await seller(), await seller()];
    const k1 = generateKeypair(), k2 = generateKeypair();
    const c1 = await svc.claimTask(s1, a.task_id, "qwen3:8b", { runner_pubkey_b64: toB64(k1.publicKey) });
    const c2 = await svc.claimTask(s2, b.task_id, "qwen3:8b", { runner_pubkey_b64: toB64(k2.publicKey) });
    expect(openJson<SellerPayload>(k1, c1.seller_envelope).prompt).toBe(PROMPT_A);
    expect(openJson<SellerPayload>(k2, c2.seller_envelope).prompt).toBe(PROMPT_B);
    expect(() => openJson(k1, c2.seller_envelope)).toThrow();
    const mid = await svc.getJobForBuyer(buyer, job.job_id);
    expect(mid.job).toMatchObject({ status: "IN_PROGRESS", reserved_cents: 200, progress: { parts: 2, in_progress: 2 } });
    expect(new Set(mid.parts.map((p) => p.seller_id))).toEqual(new Set([s1.id, s2.id]));

    // Release both claims and run them through the full cycle.
    await svc.releaseTask(s1, a.task_id, c1.claim_id, "test");
    await svc.releaseTask(s2, b.task_id, c2.claim_id, "test");
    await runCycle(s1, a.task_id);
    await runCycle(s2, b.task_id);
    await judgeAll(judge, { [a.task_id]: "APPROVE", [b.task_id]: "APPROVE" });

    const done = await svc.getJobForBuyer(buyer, job.job_id);
    expect(done.job).toMatchObject({ status: "COMPLETE", reserved_cents: 0, spent_cents: 120, progress: { parts: 2, approved: 2, failed_latest: 0 } });
    expect(await svc.getAgent(buyer.id)).toMatchObject({ reserved_cents: 0, spent_cents: 120 });

    const publicView = JSON.stringify([await svc.dashboard(), await svc.listSellers()]);
    expect(publicView).not.toContain("PART-A-SECRET");
    expect(publicView).not.toContain("PART-B-SECRET");
    expect(publicView).toContain(job.job_id);
  });

  it("re-posting a live part returns it, so a restarted buyer never pays twice", async () => {
    const buyer = await agent("buyer");
    const { job } = await svc.createJob(buyer, { budget_cents: 300 });
    const hold = vi.spyOn(payments(), "hold");
    const first = await post(buyer, { job_id: job.job_id, part_key: "p1" });
    const again = await svc.postTask((await svc.getAgent(buyer.id))!, { prompt: "different text", allowed_models: ["qwen3:8b"], max_price_cents: 100, rubric: { kind: "contains_text", expected_text: "x" }, job_id: job.job_id, part_key: "p1" });
    expect(again).toMatchObject({ idempotent: true, task: { task_id: first.task_id } });
    expect(hold).toHaveBeenCalledTimes(1);
    expect(await svc.getAgent(buyer.id)).toMatchObject({ reserved_cents: 100 });
  });

  it("a failed part gets a new attempt, and the job budget covers every attempt", async () => {
    const buyer = await agent("buyer");
    const judge = await agent("judge");
    const s = await seller();
    const { job } = await svc.createJob(buyer, { budget_cents: 150 });
    const a1 = await post(buyer, { job_id: job.job_id, part_key: "p1" });
    await runCycle(s, a1.task_id, "wrong");
    await judgeAll(judge, { [a1.task_id]: "REJECT" });
    expect((await svc.getJobForBuyer(buyer, job.job_id)).job).toMatchObject({ status: "PARTIAL_FAILURE", progress: { rejected: 1, failed_latest: 1 } });

    const a2 = await post(buyer, { job_id: job.job_id, part_key: "p1" });
    expect(a2).toMatchObject({ part_key: "p1", attempt: 2 });
    expect(a2.task_id).not.toBe(a1.task_id);
    const before = (await svc.getAgent(buyer.id))!.reserved_cents;
    const err = await expectError(post(buyer, { job_id: job.job_id, part_key: "p2" }), "JOB_BUDGET_EXCEEDED");
    expect(err.next_action).toBeTruthy();
    expect((await svc.getAgent(buyer.id))!.reserved_cents).toBe(before); // nothing leaked from the refused part
    const view = await svc.getJobForBuyer(buyer, job.job_id);
    expect(view.job).toMatchObject({ status: "IN_PROGRESS", reserved_cents: 100, progress: { parts: 1, open: 1, failed_latest: 0 } });
    expect(view.parts.map((p) => p.attempt)).toEqual([1, 2]);
  });

  it("a part that fails while another succeeds leaves the failure visible", async () => {
    const buyer = await agent("buyer");
    const judge = await agent("judge");
    const s = await seller();
    const { job } = await svc.createJob(buyer, { budget_cents: 200 });
    const a = await post(buyer, { job_id: job.job_id, part_key: "a" });
    const b = await post(buyer, { job_id: job.job_id, part_key: "b" });
    await runCycle(s, a.task_id);
    await runCycle(s, b.task_id, "wrong");
    await judgeAll(judge, { [a.task_id]: "APPROVE", [b.task_id]: "REJECT" });
    expect((await svc.getJobForBuyer(buyer, job.job_id)).job).toMatchObject({ status: "PARTIAL_FAILURE", progress: { parts: 2, approved: 1, rejected: 1, failed_latest: 1 } });
  });

  it("concurrent identical part posts create one task and give the loser's hold back", async () => {
    const buyer = await agent("buyer");
    const { job } = await svc.createJob(buyer, { budget_cents: 300 });
    const release = vi.spyOn(payments(), "release");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const one = () => post(buyer, { job_id: job.job_id, part_key: "same" });
    const [x, y] = await Promise.all([one(), one()]);
    expect(x.task_id).toBe(y.task_id);
    expect(release).toHaveBeenCalledTimes(1);
    expect(await svc.getAgent(buyer.id)).toMatchObject({ reserved_cents: 100 });
    expect((await svc.getJobForBuyer(buyer, job.job_id)).job.reserved_cents).toBe(100);
  });

  it("another buyer can neither read a job nor post into it", async () => {
    const owner = await agent("buyer");
    const other = await agent("buyer");
    const { job } = await svc.createJob(owner, { budget_cents: 100 });
    await expectError(svc.getJobForBuyer(other, job.job_id), "NOT_FOUND");
    await expectError(post(other, { job_id: job.job_id, part_key: "x" }), "NOT_FOUND");
    expect((await svc.listJobsForBuyer(other)).map((j) => j.job_id)).not.toContain(job.job_id);
  });

  it("create_job keeps within the available cap and is idempotent by client_job_key", async () => {
    const buyer = await agent("buyer", 500);
    await expectError(svc.createJob(buyer, { budget_cents: 600 }), "SPEND_CAP_EXCEEDED");
    const a = await svc.createJob(buyer, { budget_cents: 300, client_job_key: "job-key-123" });
    const b = await svc.createJob(buyer, { budget_cents: 300, client_job_key: "job-key-123" });
    expect(b).toMatchObject({ idempotent: true, job: { job_id: a.job.job_id } });
    await expectError(svc.createJob(buyer, { budget_cents: 10, client_job_key: "short" }), "VALIDATION_ERROR");
  });

  it("validates part fields", async () => {
    const buyer = await agent("buyer");
    const { job } = await svc.createJob(buyer, { budget_cents: 100 });
    await expectError(post(buyer, { job_id: job.job_id }), "VALIDATION_ERROR");
    await expectError(post(buyer, { part_key: "p" }), "VALIDATION_ERROR");
    await expectError(post(buyer, { job_id: job.job_id, part_key: "has space" }), "VALIDATION_ERROR");
    await expectError(post(buyer, { part_label: "x" }), "VALIDATION_ERROR");
  });
});

describe("V1: a post whose response was lost", () => {
  it("repeating client_request_id returns the accepted task with no second hold", async () => {
    const buyer = await agent("buyer");
    const hold = vi.spyOn(payments(), "hold");
    const first = await post(buyer, { client_request_id: "req-0001-abcd" });
    // The client never saw `first` and retries the same post.
    const retry = await svc.postTask((await svc.getAgent(buyer.id))!, { prompt: "What is the capital of Peru? One word.", allowed_models: ["qwen3:8b"], max_price_cents: 100, rubric: { kind: "contains_text", expected_text: "Lima" }, client_request_id: "req-0001-abcd" });
    expect(retry).toMatchObject({ idempotent: true, task: { task_id: first.task_id } });
    expect(hold).toHaveBeenCalledTimes(1);
    expect(await svc.getAgent(buyer.id)).toMatchObject({ reserved_cents: 100 });
    // Another buyer's identical id is independent.
    const other = await agent("buyer");
    expect((await post(other, { client_request_id: "req-0001-abcd" })).task_id).not.toBe(first.task_id);
  });
});

describe("I1: Inkbox thread state survives a restart", () => {
  it("persists the thread owner and contexts returned by notify and hands them back", async () => {
    const buyer = await agent("buyer");
    const judge = await agent("judge");
    const s = await seller();
    unwrap(await db().from("agents").update({ inkbox_handle: "atm-seller-x" }).eq("id", s.id));
    unwrap(await db().from("agents").update({ inkbox_handle: "atm-buyer-x" }).eq("id", buyer.id));
    const notify = vi.spyOn(inkbox, "notify").mockImplementation(async (ev) =>
      (ev.type === "verdict" ? { context_id: "ctx-seller", buyer_context_id: "ctx-buyer" } : "ctx-seller") as unknown as string,
    );
    const task = await post(buyer);
    const { submitted } = await runCycle((await svc.getAgent(s.id))!, task.task_id);
    expect(await taskRow(task.task_id)).toMatchObject({ inkbox_context_id: "ctx-seller", inkbox_thread_owner: "atm-seller-x" });
    await svc.submitVerdict(judge, { task_id: task.task_id, result_id: submitted.result_id, verdict: "APPROVE", reason_code: "RUBRIC_MATCH" });
    expect(await taskRow(task.task_id)).toMatchObject({ inkbox_buyer_context_id: "ctx-buyer" });
    const verdictCall = notify.mock.calls.find((c) => c[0].type === "verdict")![0] as Record<string, unknown>;
    expect(verdictCall).toMatchObject({ context_id: "ctx-seller", thread_owner: "atm-seller-x", to_handle: "atm-buyer-x" });
  });

  it("a failing notice never fails the tool", async () => {
    const buyer = await agent("buyer");
    const s = await seller();
    vi.spyOn(inkbox, "notify").mockRejectedValue(new Error("inkbox down"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const task = await post(buyer);
    await expect(runCycle(s, task.task_id)).resolves.toBeTruthy();
  });
});

describe("B1: usage records", () => {
  it("accepts unmeasured quantities as null and requires the schema tag", () => {
    const rec = { schema: "atm.usage.v1", run_id: "r1", case_id: "c1", arm: "marketplace", component: "seller", provider: "ollama", model: "qwen3:8b", started_at: "2026-10-18T03:00:00Z", ended_at: "2026-10-18T03:00:05Z", latency_ms: 5000, input_tokens: null, output_tokens: 12, retries: 0, success: true, energy_wh: null, cost_usd: null };
    expect(UsageRecord.parse(rec).input_tokens).toBeNull();
    expect(() => UsageRecord.parse({ ...rec, schema: "other" })).toThrow();
    expect(() => UsageRecord.parse({ ...rec, arm: "cloud" })).toThrow();
  });
});

describe("migrations", () => {
  it("every startup patch that adds a column or index is also in db/schema.sql", () => {
    const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8").toLowerCase();
    for (const stmt of SCHEMA_PATCHES.filter((p) => /^(alter|create)/i.test(p))) {
      const name = /add column if not exists (\w+)/i.exec(stmt)?.[1] ?? /(?:index|table) if not exists (\w+)/i.exec(stmt)?.[1];
      expect(name, stmt).toBeTruthy();
      expect(schema, stmt).toContain(name!.toLowerCase());
    }
  });
});
