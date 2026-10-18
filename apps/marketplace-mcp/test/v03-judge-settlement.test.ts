/**
 * Contract v0.3 acceptance tests for the completion audit:
 *   J1 public verdict text, J2 judge infrastructure failures, J3 replacement delivery,
 *   P1 durable settlement and hold compensation, P2 transfer retries.
 * Faults are injected into the in-memory database and the mock payment rail.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_REPLACEMENT_ATTEMPTS, MAX_REVIEW_ATTEMPTS, publicReason } from "@atm/shared";
import { db, unwrap } from "../src/db.ts";
import { inkbox } from "../src/inkbox.ts";
import { memoryDb } from "../src/memdb.ts";
import { payments } from "../src/payments.ts";
import { fetchReplacementPackage, submitReplacement } from "../src/review.ts";
import * as svc from "../src/service.ts";
import { finalizeSettlement, recordIntent, reinstateSeller } from "../src/settlement.ts";
import { agent, backdate, expectError, post, replacementFor, runCycle, seller, settlementRow, taskRow } from "./helpers.ts";

const MARKER = "PRIVATE-MARKER-7f3a";

afterEach(() => {
  memoryDb().clearFaults();
  vi.restoreAllMocks();
});

/** A task with a submitted result, ready for a verdict. */
async function submittedTask(ask = 60) {
  const buyer = await agent("buyer");
  const judge = await agent("judge");
  const s = await seller(ask);
  const task = await post(buyer);
  const { submitted } = await runCycle(s, task.task_id);
  return { buyer, judge, s, task, resultId: submitted.result_id };
}

async function fetchFor(judge: Awaited<ReturnType<typeof agent>>, taskId: string) {
  for (let i = 0; i < 50; i++) {
    const pkg = await svc.fetchReviewPackage(judge);
    if (!pkg) return null;
    if (pkg.task_id === taskId) return pkg;
    // Not ours: give it back so other tests' tasks stay reviewable.
    unwrap(await db().from("tasks").update({ status: "SUBMITTED", judge_id: null }).eq("id", pkg.task_id));
    unwrap(await db().from("tasks").update({ review_retry_at: new Date(Date.now() + 3_600_000).toISOString() }).eq("id", pkg.task_id));
  }
  return null;
}

// ---------------------------------------------------------------------------
// J1
// ---------------------------------------------------------------------------

describe("J1: public verdict text never carries judge text", () => {
  it("publishes the server's text for the code, not the judge's, on every surface", async () => {
    const { buyer, judge, task, resultId } = await submittedTask();
    const notify = vi.spyOn(inkbox, "notify");
    const logs: string[] = [];
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));

    await svc.submitVerdict(judge, { task_id: task.task_id, result_id: resultId, verdict: "APPROVE", reason_code: "RUBRIC_MATCH", reason_public: `the answer quoted ${MARKER}` });

    const surfaces = {
      get_task: await svc.getTaskForActor(buyer, task.task_id),
      get_result: await svc.getResultForBuyer((await svc.getAgent(buyer.id))!, task.task_id),
      dashboard: await svc.dashboard(),
      reputation: await svc.listSellers(),
      notices: notify.mock.calls,
      logs,
    };
    expect(JSON.stringify(surfaces)).not.toContain(MARKER);
    expect(surfaces.get_task.verdict?.reason_public).toBe(publicReason("RUBRIC_MATCH"));
    expect(surfaces.get_result.result?.answer).toBe("Lima"); // the authorised buyer still gets the answer
    const stored = unwrap(await db().from("verdicts").select("reason_public").eq("task_id", task.task_id)) as { reason_public: string }[];
    expect(stored[0]!.reason_public).not.toContain(MARKER);
  });

  it("projects rows written before v0.3 through the same text", async () => {
    const { buyer, judge, task, resultId } = await submittedTask();
    await svc.submitVerdict(judge, { task_id: task.task_id, result_id: resultId, verdict: "APPROVE", reason_code: "RUBRIC_MATCH" });
    unwrap(await db().from("verdicts").update({ reason_public: `legacy text with ${MARKER}` }).eq("task_id", task.task_id));
    const out = JSON.stringify([await svc.getTaskForActor(buyer, task.task_id), await svc.getResultForBuyer((await svc.getAgent(buyer.id))!, task.task_id), await svc.dashboard()]);
    expect(out).not.toContain(MARKER);
  });

  it("keeps the settlement's internal decision (judge id, ciphertext) off public surfaces", async () => {
    const { buyer, judge, task, resultId } = await submittedTask();
    await svc.submitVerdict(judge, { task_id: task.task_id, result_id: resultId, verdict: "APPROVE", reason_code: "RUBRIC_MATCH" });
    const d = await svc.dashboard();
    expect(d.settlements.every((s) => !("decision" in s))).toBe(true);
    expect((await svc.getTaskForActor(buyer, task.task_id)).settlement).not.toHaveProperty("decision");
  });
});

// ---------------------------------------------------------------------------
// J2
// ---------------------------------------------------------------------------

describe("J2: judge infrastructure failures defer the review", () => {
  for (const code of ["JUDGE_UNAVAILABLE", "JUDGE_TIMEOUT", "JUDGE_MALFORMED", "JUDGE_ERROR"] as const) {
    it(`${code} keeps the seller's reputation and the buyer's money untouched, then settles once after recovery`, async () => {
      const { buyer, judge, s, task, resultId } = await submittedTask();
      const capture = vi.spyOn(payments(), "capture");
      const release = vi.spyOn(payments(), "release");
      expect(await fetchFor(judge, task.task_id)).not.toBeNull();

      // The legacy runner sends REJECT with JUDGE_ERROR; the verdict value must not matter.
      const deferred = await svc.submitVerdict(judge, { task_id: task.task_id, result_id: resultId, verdict: "REJECT", reason_code: code });
      expect(deferred).toMatchObject({ deferred: true, verdict: null, settlement: null, review: { status: "RETRY_PENDING", attempts: 1 } });
      expect(deferred.task.status).toBe("SUBMITTED");
      expect(await settlementRow(task.task_id)).toBeUndefined();
      expect(await svc.sellerReputation(s.id)).toMatchObject({ status: "ACTIVE", reputation: { strikes: 0, rejections: 0 } });
      expect(await svc.getAgent(buyer.id)).toMatchObject({ reserved_cents: 100, spent_cents: 0 });
      expect(capture).not.toHaveBeenCalled();
      expect(release).not.toHaveBeenCalled();
      expect((await svc.getResultForBuyer((await svc.getAgent(buyer.id))!, task.task_id)).guidance).toMatch(/retried automatically/);

      // Not offered again until the backoff passes.
      expect(await fetchFor(judge, task.task_id)).toBeNull();
      await backdate("tasks", { col: "id", val: task.task_id }, "review_retry_at");
      expect(await fetchFor(judge, task.task_id)).not.toBeNull();

      const final = await svc.submitVerdict(judge, { task_id: task.task_id, result_id: resultId, verdict: "APPROVE", reason_code: "RUBRIC_MATCH" });
      expect(final).toMatchObject({ deferred: false, task: { status: "APPROVED", review: { status: "FINAL" } }, settlement: { seller_payout_cents: 100 } });
      expect(capture).toHaveBeenCalledTimes(1);
      expect(await svc.sellerReputation(s.id)).toMatchObject({ status: "ACTIVE", reputation: { approvals: 1, strikes: 0 } });
      expect(await svc.getAgent(buyer.id)).toMatchObject({ reserved_cents: 0, spent_cents: 100 });
    });
  }

  it(`marks the review JUDGE_UNAVAILABLE after ${MAX_REVIEW_ATTEMPTS} deferrals and still accepts a later verdict`, async () => {
    const { judge, s, task, resultId } = await submittedTask();
    let last;
    for (let i = 0; i < MAX_REVIEW_ATTEMPTS; i++) last = await svc.submitVerdict(judge, { task_id: task.task_id, result_id: resultId, verdict: "REJECT", reason_code: "JUDGE_UNAVAILABLE" });
    expect(last!.review).toMatchObject({ status: "JUDGE_UNAVAILABLE", attempts: MAX_REVIEW_ATTEMPTS });
    expect(Date.parse(last!.review.retry_at!) - Date.now()).toBeLessThanOrEqual(600_000);
    const done = await svc.submitVerdict(judge, { task_id: task.task_id, result_id: resultId, verdict: "REJECT", reason_code: "RUBRIC_MISMATCH" });
    expect(done.task.status).toBe("REJECTED");
    expect((await svc.sellerReputation(s.id)).reputation.strikes).toBe(1);
  });

  it("refuses a quality code that contradicts the verdict", async () => {
    const { judge, task, resultId } = await submittedTask();
    await expectError(svc.submitVerdict(judge, { task_id: task.task_id, result_id: resultId, verdict: "APPROVE", reason_code: "RUBRIC_MISMATCH" }), "VALIDATION_ERROR");
    await expectError(svc.submitVerdict(judge, { task_id: task.task_id, result_id: resultId, verdict: "REJECT", reason_code: "LLM_RUBRIC_PASS" }), "VALIDATION_ERROR");
    expect((await taskRow(task.task_id)).status).toBe("SUBMITTED");
  });
});

// ---------------------------------------------------------------------------
// J3
// ---------------------------------------------------------------------------

describe("J3: replacement answers have an explicit, recoverable status", () => {
  it("a REJECT without a replacement stays PENDING until a judge delivers one, without new money or strike effects", async () => {
    const { buyer, judge, s, task, resultId } = await submittedTask();
    const release = vi.spyOn(payments(), "release");
    await svc.submitVerdict(judge, { task_id: task.task_id, result_id: resultId, verdict: "REJECT", reason_code: "COMMITMENT_MISMATCH" });
    expect((await taskRow(task.task_id)).replacement_status).toBe("PENDING");
    const before = await svc.getResultForBuyer((await svc.getAgent(buyer.id))!, task.task_id);
    expect(before).toMatchObject({ replacement_status: "PENDING", replacement_answer: null });
    expect(before.guidance).toMatch(/still being prepared/);

    // Provider still down: one failed attempt, backoff, then success.
    let pkg = await fetchReplacementPackage(judge);
    while (pkg && pkg.task_id !== task.task_id) pkg = await fetchReplacementPackage(judge);
    expect(pkg).toMatchObject({ task_id: task.task_id, result_id: resultId, attempts: 0 });
    expect(await submitReplacement(judge, { task_id: task.task_id, result_id: resultId, reason_code: "JUDGE_UNAVAILABLE" })).toMatchObject({ replacement_status: "PENDING", attempts: 1 });
    expect(await fetchReplacementPackage(judge)).toBeNull();
    await backdate("tasks", { col: "id", val: task.task_id }, "replacement_retry_at");
    pkg = await fetchReplacementPackage(judge);
    expect(pkg?.task_id).toBe(task.task_id);
    await expectError(submitReplacement(judge, { task_id: task.task_id, result_id: resultId }), "VALIDATION_ERROR");

    const delivered = await submitReplacement(judge, { task_id: task.task_id, result_id: resultId, replacement_enc_buyer: replacementFor(pkg!.buyer_public_key, "Lima (judge)") });
    expect(delivered).toMatchObject({ idempotent: false, replacement_status: "DELIVERED" });
    expect(await submitReplacement(judge, { task_id: task.task_id, result_id: resultId, replacement_enc_buyer: replacementFor(pkg!.buyer_public_key, "again") })).toMatchObject({ idempotent: true });
    const after = await svc.getResultForBuyer((await svc.getAgent(buyer.id))!, task.task_id);
    expect(after).toMatchObject({ replacement_status: "DELIVERED", replacement_answer: "Lima (judge)" });

    expect(release).toHaveBeenCalledTimes(1);
    expect((await svc.sellerReputation(s.id)).reputation.strikes).toBe(1);
    expect(await svc.getAgent(buyer.id)).toMatchObject({ reserved_cents: 0, spent_cents: 0 });
  });

  it(`gives up truthfully after ${MAX_REPLACEMENT_ATTEMPTS} failed attempts`, async () => {
    const { buyer, judge, task, resultId } = await submittedTask();
    await svc.submitVerdict(judge, { task_id: task.task_id, result_id: resultId, verdict: "REJECT", reason_code: "RUBRIC_MISMATCH" });
    let out;
    for (let i = 0; i < MAX_REPLACEMENT_ATTEMPTS; i++) out = await submitReplacement(judge, { task_id: task.task_id, result_id: resultId, reason_code: "JUDGE_TIMEOUT" });
    expect(out).toMatchObject({ replacement_status: "UNAVAILABLE" });
    const r = await svc.getResultForBuyer((await svc.getAgent(buyer.id))!, task.task_id);
    expect(r).toMatchObject({ replacement_status: "UNAVAILABLE", replacement_answer: null });
    expect(r.guidance).toMatch(/No replacement answer is available/);
  });

  it("a REJECT that carries a replacement is DELIVERED at once; one sealed to the wrong key is refused", async () => {
    const { buyer, judge, task, resultId } = await submittedTask();
    const buyerKey = { key_id: buyer.buyer_key_id!, public_key_b64: buyer.buyer_pubkey_b64! };
    await expectError(
      svc.submitVerdict(judge, { task_id: task.task_id, result_id: resultId, verdict: "REJECT", reason_code: "RUBRIC_MISMATCH", replacement_enc_buyer: replacementFor({ ...buyerKey, key_id: "buyer-other" }, "x") }),
      "VALIDATION_ERROR",
    );
    await svc.submitVerdict(judge, { task_id: task.task_id, result_id: resultId, verdict: "REJECT", reason_code: "RUBRIC_MISMATCH", replacement_enc_buyer: replacementFor(buyerKey, "Lima") });
    expect(await svc.getResultForBuyer((await svc.getAgent(buyer.id))!, task.task_id)).toMatchObject({ replacement_status: "DELIVERED", replacement_answer: "Lima" });
  });
});

// ---------------------------------------------------------------------------
// P1
// ---------------------------------------------------------------------------

describe("P1: settlement survives a failure after each side effect", () => {
  it("post_task: a failed durable insert creates no hold or reservation", async () => {
    const buyer = await agent("buyer");
    const release = vi.spyOn(payments(), "release");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    memoryDb().injectFault("tasks", "insert");
    await expectError(post(buyer), "INTERNAL_ERROR");
    expect(release).not.toHaveBeenCalled();
    expect(await svc.getAgent(buyer.id)).toMatchObject({ reserved_cents: 0, spent_cents: 0 });
    expect(await post(buyer)).toMatchObject({ status: "OPEN" }); // the buyer can post again
  });

  it("verdict: a crash after the money moved is finished by a retry without a second capture, whatever the retry says", async () => {
    const { buyer, judge, s, task, resultId } = await submittedTask();
    const capture = vi.spyOn(payments(), "capture");
    memoryDb().injectFault("verdicts", "insert");
    await expectError(svc.submitVerdict(judge, { task_id: task.task_id, result_id: resultId, verdict: "APPROVE", reason_code: "RUBRIC_MATCH" }), "INTERNAL_ERROR");
    expect(await settlementRow(task.task_id)).toMatchObject({ outcome: "APPROVE", state: "RECORDED", finalized_at: null });
    expect((await taskRow(task.task_id)).status).toBe("SUBMITTED");

    const retry = await svc.submitVerdict(judge, { task_id: task.task_id, result_id: resultId, verdict: "REJECT", reason_code: "RUBRIC_MISMATCH" });
    expect(retry).toMatchObject({ idempotent: true, resumed: true, task: { status: "APPROVED" }, verdict: { verdict: "APPROVE" } });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(await svc.getAgent(buyer.id)).toMatchObject({ reserved_cents: 0, spent_cents: 100 });
    expect((await svc.sellerReputation(s.id)).reputation).toMatchObject({ approvals: 1, rejections: 0, strikes: 0 });
  });

  it("verdict: a crash before the balance write is finished by housekeeping, and nothing applies twice", async () => {
    const { buyer, judge, s, task, resultId } = await submittedTask();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    memoryDb().injectFault("agents", "update");
    await expectError(svc.submitVerdict(judge, { task_id: task.task_id, result_id: resultId, verdict: "REJECT", reason_code: "RUBRIC_MISMATCH" }), "INTERNAL_ERROR");
    expect((await taskRow(task.task_id)).status).toBe("REJECTED");
    expect(await svc.getAgent(buyer.id)).toMatchObject({ reserved_cents: 100 });
    expect((await settlementRow(task.task_id))!.finalized_at).toBeNull();

    await backdate("settlements", { col: "task_id", val: task.task_id }, "created_at");
    expect((await svc.expireStale()).resumed).toBeGreaterThanOrEqual(1);
    expect((await settlementRow(task.task_id))!.finalized_at).toBeTruthy();
    expect(await svc.getAgent(buyer.id)).toMatchObject({ reserved_cents: 0, spent_cents: 0 });

    await finalizeSettlement(task.task_id); // again: no effect
    await svc.submitVerdict(judge, { task_id: task.task_id, result_id: resultId, verdict: "REJECT", reason_code: "RUBRIC_MISMATCH" });
    expect(await svc.getAgent(buyer.id)).toMatchObject({ reserved_cents: 0, spent_cents: 0 });
    expect((await svc.sellerReputation(s.id)).reputation).toMatchObject({ rejections: 1, strikes: 1 });
  });

  it("reinstatement holds: an earlier rejection stops counting as a strike until a new one lands", async () => {
    const { buyer, judge, s, task, resultId } = await submittedTask();
    await svc.submitVerdict(judge, { task_id: task.task_id, result_id: resultId, verdict: "REJECT", reason_code: "RUBRIC_MISMATCH" });
    expect(await svc.sellerReputation(s.id)).toMatchObject({ status: "SUSPENDED", reputation: { rejections: 1, strikes: 1 } });

    await new Promise((r) => setTimeout(r, 5));
    expect((await reinstateSeller(s.id))?.status).toBe("ACTIVE");
    expect(await svc.sellerReputation(s.id)).toMatchObject({ status: "ACTIVE", reputation: { rejections: 1, strikes: 0 } });

    // A later approval recomputes reputation and must not re-suspend.
    await new Promise((r) => setTimeout(r, 5));
    const next = await post(buyer);
    const { submitted } = await runCycle(s, next.task_id);
    await svc.submitVerdict(judge, { task_id: next.task_id, result_id: submitted.result_id, verdict: "APPROVE", reason_code: "RUBRIC_MATCH" });
    expect(await svc.sellerReputation(s.id)).toMatchObject({ status: "ACTIVE", reputation: { approvals: 1, rejections: 1, strikes: 0 } });

    // A new rejection after reinstatement is a fresh strike.
    const again = await post(buyer);
    const run = await runCycle(s, again.task_id);
    await svc.submitVerdict(judge, { task_id: again.task_id, result_id: run.submitted.result_id, verdict: "REJECT", reason_code: "RUBRIC_MISMATCH" });
    expect(await svc.sellerReputation(s.id)).toMatchObject({ status: "SUSPENDED", reputation: { rejections: 2, strikes: 1 } });
  });

  it("concurrent finalizers apply each effect once and only one reports finishing", async () => {
    const { buyer, judge, s, task, resultId } = await submittedTask();
    await recordIntent(await taskRow(task.task_id), { outcome: "APPROVE", seller_payout_cents: 100, result_id: resultId, reason_code: "RUBRIC_MATCH", judge_id: judge.id });
    const results = await Promise.all([finalizeSettlement(task.task_id), finalizeSettlement(task.task_id), finalizeSettlement(task.task_id)]);
    expect(results.filter((r) => r.finishedNow)).toHaveLength(1);
    expect(await svc.getAgent(buyer.id)).toMatchObject({ reserved_cents: 0, spent_cents: 100 });
    expect((await svc.sellerReputation(s.id)).reputation.approvals).toBe(1);
    const verdicts = unwrap(await db().from("verdicts").select("id").eq("task_id", task.task_id)) as unknown[];
    expect(verdicts).toHaveLength(1);
  });

  it("cancel: a provider outage leaves the listing closed and the release recorded for retry", async () => {
    const buyer = await agent("buyer");
    const task = await post(buyer);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(payments(), "release").mockRejectedValueOnce(new Error("stripe down"));
    expect(await svc.cancelTask((await svc.getAgent(buyer.id))!, task.task_id)).toMatchObject({ status: "CANCELLED" });
    const s1 = await seller();
    await expectError(svc.claimTask(s1, task.task_id, "qwen3:8b", { runner_pubkey_b64: (await import("@atm/crypto")).toB64((await import("@atm/crypto")).generateKeypair().publicKey) }), "CLAIM_CONFLICT");
    expect(await settlementRow(task.task_id)).toMatchObject({ outcome: "CANCEL", state: "PENDING" });
    expect(await svc.getAgent(buyer.id)).toMatchObject({ reserved_cents: 100 });

    await backdate("settlements", { col: "task_id", val: task.task_id }, "created_at");
    await svc.expireStale();
    expect(await settlementRow(task.task_id)).toMatchObject({ outcome: "CANCEL", state: "RECORDED" });
    expect(await svc.getAgent(buyer.id)).toMatchObject({ reserved_cents: 0 });
  });

  it("a closed task whose decision was never recorded (crash right after closing) is settled by housekeeping", async () => {
    const buyer = await agent("buyer");
    const task = await post(buyer);
    unwrap(await db().from("tasks").update({ status: "CANCELLED", settle_pending: true }).eq("id", task.task_id));
    await backdate("tasks", { col: "id", val: task.task_id }, "updated_at");
    await svc.expireStale();
    expect(await settlementRow(task.task_id)).toMatchObject({ outcome: "CANCEL", state: "RECORDED" });
    expect((await settlementRow(task.task_id))!.finalized_at).toBeTruthy();
    expect(await taskRow(task.task_id)).toMatchObject({ settle_pending: false });
    expect(await svc.getAgent(buyer.id)).toMatchObject({ reserved_cents: 0 });
  });
});

// ---------------------------------------------------------------------------
// P2
// ---------------------------------------------------------------------------

describe("P2: a captured payment whose transfer failed is retried until it completes once", () => {
  it("retries with backoff through the provider hook and records the transfer id", async () => {
    const { judge, task, resultId } = await submittedTask();
    await svc.submitVerdict(judge, { task_id: task.task_id, result_id: resultId, verdict: "APPROVE", reason_code: "RUBRIC_MATCH" });
    // Simulate a card capture whose transfer was refused (mock rails never transfer).
    unwrap(await db().from("settlements").update({ transfer_state: "PENDING", payout_owed_cents: 100, payout_transferred_cents: 0 }).eq("task_id", task.task_id));
    const provider = payments();
    const originalRetry = provider.retryTransfer;
    const retryTransfer = vi.fn().mockResolvedValueOnce({ transfer_id: null, state: "PENDING", amount_cents: 0, retry_safe_to_advance: true, pending_reason: "PENDING_ONBOARDING", note: "not onboarded" }).mockResolvedValueOnce({ transfer_id: "tr_test_1", state: "TRANSFERRED", amount_cents: 100, note: "transferred" });
    provider.retryTransfer = retryTransfer;
    try {
      await svc.expireStale();
      expect(await settlementRow(task.task_id)).toMatchObject({ transfer_state: "PENDING", transfer_attempts: 1, payout_transferred_cents: 0 });
      await svc.expireStale(); // still backing off
      expect(retryTransfer).toHaveBeenCalledTimes(1);
      await backdate("settlements", { col: "task_id", val: task.task_id }, "transfer_retry_at");
      await svc.expireStale();
      expect(await settlementRow(task.task_id)).toMatchObject({ transfer_state: "TRANSFERRED", stripe_transfer_id: "tr_test_1", payout_transferred_cents: 100 });
      await backdate("settlements", { col: "task_id", val: task.task_id }, "transfer_retry_at");
      await svc.expireStale();
      expect(retryTransfer).toHaveBeenCalledTimes(2);
      expect(retryTransfer.mock.calls[0]![2]).toBe(100);
    } finally {
      provider.retryTransfer = originalRetry;
    }
  });
});
