import { describe, expect, it, vi } from "vitest";
import { generateKeypair, keypairFromSecretB64, openJson, toB64 } from "@atm/crypto";
import { createRunner, type RunnerHost } from "@atm/runner-core";
import { MAX_PRICE_CENTS, MarketplaceError, type ClaimPublicV02, type KeyDescriptor, type SellerPayload } from "@atm/shared";
import { db, unwrap, type AgentRow, type TaskRow } from "../src/db.ts";
import { payments } from "../src/payments.ts";
import * as svc from "../src/service.ts";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Stands in for Ollama: lists qwen3:8b and answers every chat with `answer`. */
function fakeOllamaHost(answer: string): RunnerHost {
  const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
  return {
    fetch: (async (url: string | URL | Request) =>
      String(url).endsWith("/api/tags") ? json({ models: [{ name: "qwen3:8b", digest: "test" }] }) : json({ message: { content: answer }, eval_count: 3 })) as typeof fetch,
    getSecret: async () => undefined,
    now: () => Date.now(),
  };
}

const judgeHost: RunnerHost = { fetch: (async () => new Response("no network in tests", { status: 503 })) as typeof fetch, getSecret: async () => undefined, now: () => Date.now() };
const judgeKeypair = () => keypairFromSecretB64(process.env.JUDGE_PRIVATE_KEY_B64!);

let n = 0;
async function agent(kind: "buyer" | "seller" | "judge"): Promise<AgentRow> {
  const { agent } = await svc.registerAgent({ kind, display_name: `${kind}-${++n}`, judge_secret: kind === "judge" ? "test-judge-secret" : undefined });
  return agent;
}

async function seller(opts: { registeredKey?: KeyDescriptor; ask?: number } = {}): Promise<AgentRow> {
  const a = await agent("seller");
  await svc.registerSeller(a, {
    models: [{ model_id: "qwen3:8b", ask_cents: opts.ask ?? 60 }],
    runner_pubkey_b64: opts.registeredKey?.public_key_b64,
    runner_key_id: opts.registeredKey?.key_id,
    runtime: "wassette",
  });
  return a;
}

async function post(buyer: AgentRow, expected = "Lima") {
  const fresh = (await svc.getAgent(buyer.id))!;
  const { task } = await svc.postTask(fresh, {
    prompt: "What is the capital of Peru? One word.",
    allowed_models: ["qwen3:8b"],
    max_price_cents: 100,
    rubric: { kind: "contains_text", expected_text: expected },
  });
  return task;
}

async function taskRow(id: string): Promise<TaskRow> {
  return (await svc.getTask(id))!;
}

async function expectError(p: Promise<unknown>, code: string): Promise<MarketplaceError> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(MarketplaceError);
  expect((err as MarketplaceError).code).toBe(code);
  return err as MarketplaceError;
}

/** Seller side of one cycle, as the sandbox does it: key → claim → decrypt → run → seal → submit. */
async function runCycle(s: AgentRow, taskId: string, answer = "Lima") {
  const runner = createRunner(fakeOllamaHost(answer));
  const key = runner.getPublicKey();
  const claim = await svc.claimTask(s, taskId, "qwen3:8b", { runner_pubkey_b64: key.public_key_b64, runner_key_id: key.key_id });
  const out = await runner.runTask(claim.seller_envelope, {
    ollama_url: "http://ollama.test",
    model_id: claim.model_id,
    buyer_public_key: claim.buyer_public_key,
    judge_public_key: claim.judge_public_key,
  });
  const submitted = await svc.submitResult(s, taskId, claim.claim_id, out);
  return { claim, key, submitted };
}

/** Judge side: fetch → judge inside the runner core → submit_verdict. */
async function judgeOnce(judge: AgentRow) {
  const pkg = await svc.fetchReviewPackage(judge);
  expect(pkg).not.toBeNull();
  const verdict = await createRunner(judgeHost).judgeTask(pkg!.payload_enc_judge, pkg!.result_enc_judge, { buyer_public_key: pkg!.buyer_public_key, commitment_sha256: pkg!.commitment_sha256 }, judgeKeypair());
  return svc.submitVerdict(judge, { task_id: pkg!.task_id, result_id: pkg!.result_id, ...verdict });
}

// ---------------------------------------------------------------------------
// contract v0.2: per-claim runner keys
// ---------------------------------------------------------------------------

describe("claim_task with a per-claim runner key (contract v0.2)", () => {
  it("seals the task to the presented key and returns buyer + judge keys", async () => {
    const buyer = await agent("buyer");
    const s = await seller();
    const task = await post(buyer);
    const kp = generateKeypair();
    const claim: ClaimPublicV02 = await svc.claimTask(s, task.task_id, "qwen3:8b", { runner_pubkey_b64: toB64(kp.publicKey) });

    expect(claim.runner_key_source).toBe("per-claim");
    expect(claim.runner_key_id).toMatch(/^runner-[0-9a-f]{16}$/);
    expect(claim.seller_envelope.recipient_key_id).toBe(claim.runner_key_id);
    const payload = openJson<SellerPayload>(kp, claim.seller_envelope);
    expect(payload).toMatchObject({ task_id: task.task_id, claim_id: claim.claim_id, prompt: "What is the capital of Peru? One word." });
    expect(payload).not.toHaveProperty("rubric");
    expect(claim.buyer_public_key.key_id).toBe(buyer.buyer_key_id);
    expect(claim.judge_public_key).toEqual({ key_id: process.env.JUDGE_KEY_ID, public_key_b64: process.env.JUDGE_PUBLIC_KEY_B64 });

    const row = await taskRow(task.task_id);
    expect(row).toMatchObject({ status: "PAYLOAD_READY", claim_runner_key_id: claim.runner_key_id, claim_runner_pubkey_b64: toB64(kp.publicKey) });
    const pub = await svc.sellerReputation(s.id);
    expect(pub.runner).toMatchObject({ key_source: "per-claim", public_key: { key_id: claim.runner_key_id } });
  });

  it("keeps the caller's runner_key_id when one is given", async () => {
    const buyer = await agent("buyer");
    const s = await seller();
    const task = await post(buyer);
    const kp = generateKeypair();
    const claim = await svc.claimTask(s, task.task_id, "qwen3:8b", { runner_pubkey_b64: toB64(kp.publicKey), runner_key_id: "runner-custom" });
    expect(claim.seller_envelope.recipient_key_id).toBe("runner-custom");
  });

  it("rejects a claim with no per-claim key when the seller registered none", async () => {
    const buyer = await agent("buyer");
    const s = await seller();
    const task = await post(buyer);
    const err = await expectError(svc.claimTask(s, task.task_id, "qwen3:8b"), "INVALID_STATE");
    expect(err.next_action).toMatch(/runner_pubkey_b64/);
    expect((await taskRow(task.task_id)).status).toBe("OPEN");
  });

  it("rejects keys that are not 32-byte X25519 public keys", async () => {
    const buyer = await agent("buyer");
    const s = await seller();
    const task = await post(buyer);
    for (const bad of [toB64(new Uint8Array(31)), "!".repeat(44)]) {
      const err = await expectError(svc.claimTask(s, task.task_id, "qwen3:8b", { runner_pubkey_b64: bad }), "VALIDATION_ERROR");
      expect(err.next_action).toBeTruthy();
    }
    await expectError(svc.claimTask(s, task.task_id, "qwen3:8b", { runner_key_id: "runner-x" }), "VALIDATION_ERROR");
    expect((await taskRow(task.task_id)).status).toBe("OPEN");
  });

  it("still seals to the registered key when no per-claim key is sent (v0.1 sellers)", async () => {
    const buyer = await agent("buyer");
    const runner = createRunner(fakeOllamaHost("Lima"));
    const s = await seller({ registeredKey: runner.getPublicKey() });
    const task = await post(buyer);
    const claim = await svc.claimTask(s, task.task_id, "qwen3:8b");
    expect(claim.runner_key_source).toBe("registered");
    expect(claim.runner_key_id).toBe(runner.getPublicKey().key_id);
    const pub = await svc.sellerReputation(s.id);
    expect(pub.runner.key_source).toBe("registered");
  });

  it("a per-claim key overrides the registered key for that claim", async () => {
    const buyer = await agent("buyer");
    const s = await seller({ registeredKey: createRunner(fakeOllamaHost("x")).getPublicKey() });
    const task = await post(buyer);
    const kp = generateKeypair();
    const claim = await svc.claimTask(s, task.task_id, "qwen3:8b", { runner_pubkey_b64: toB64(kp.publicKey) });
    expect(claim.runner_key_source).toBe("per-claim");
    expect(openJson<SellerPayload>(kp, claim.seller_envelope).claim_id).toBe(claim.claim_id);
  });

  it("register_seller validates an optional key and accepts none", async () => {
    const s = await agent("seller");
    await expectError(svc.registerSeller(s, { models: [{ model_id: "qwen3:8b", ask_cents: 60 }], runner_pubkey_b64: toB64(new Uint8Array(16)), runtime: "wassette" }), "VALIDATION_ERROR");
    await expectError(svc.registerSeller(s, { models: [{ model_id: "qwen3:8b", ask_cents: 60 }], runner_key_id: "runner-x", runtime: "wassette" }), "VALIDATION_ERROR");
    const pub = await svc.registerSeller(s, { models: [{ model_id: "qwen3:8b", ask_cents: 60 }], runtime: "wassette" });
    expect(pub.runner).toMatchObject({ key_source: "none", public_key: { key_id: "none" } });
  });
});

// ---------------------------------------------------------------------------
// end to end through the runner core (what run-cycle / judge-cycle do)
// ---------------------------------------------------------------------------

describe("full cycle", () => {
  it("APPROVE: buyer reads a commitment-verified answer and is charged the seller's price", async () => {
    const buyer = await agent("buyer");
    const judge = await agent("judge");
    const s = await seller({ ask: 75 });
    const task = await post(buyer);
    expect((await svc.getAgent(buyer.id))!.reserved_cents).toBe(100);

    const { submitted } = await runCycle(s, task.task_id, "Lima");
    expect(submitted.task.status).toBe("SUBMITTED");
    const row = await taskRow(task.task_id);
    expect(row.plaintext_enc_server).toBeNull();
    expect(row.payload_enc_seller).toBeNull();

    const v = await judgeOnce(judge);
    expect(v).toMatchObject({ idempotent: false, task: { status: "APPROVED" }, verdict: { verdict: "APPROVE", reason_code: "RUBRIC_MATCH" }, settlement: { kind: "MOCK", seller_payout_cents: 75, buyer_refund_cents: 25 } });

    const result = await svc.getResultForBuyer((await svc.getAgent(buyer.id))!, task.task_id);
    expect(result.result).toMatchObject({ answer: "Lima", commitment_verified: true });
    expect(await svc.getAgent(buyer.id)).toMatchObject({ reserved_cents: 0, spent_cents: 75 });
    expect((await svc.sellerReputation(s.id)).reputation.approvals).toBe(1);

    // submit_verdict is idempotent per task
    const again = await svc.submitVerdict(judge, { task_id: task.task_id, result_id: submitted.result_id, verdict: "REJECT", reason_code: "RUBRIC_MISMATCH", reason_public: "x" });
    expect(again.idempotent).toBe(true);
    expect((await taskRow(task.task_id)).status).toBe("APPROVED");
  });

  it("REJECT: hold released, seller struck and suspended, next claim refused", async () => {
    const buyer = await agent("buyer");
    const judge = await agent("judge");
    const s = await seller();
    const task = await post(buyer, "Lima");
    await runCycle(s, task.task_id, "Bogota");
    const v = await judgeOnce(judge);
    expect(v).toMatchObject({ task: { status: "REJECTED" }, verdict: { reason_code: "RUBRIC_MISMATCH" }, settlement: { seller_payout_cents: 0, buyer_refund_cents: 100 }, seller_status: "SUSPENDED" });
    expect(await svc.getAgent(buyer.id)).toMatchObject({ reserved_cents: 0, spent_cents: 0 });

    const next = await post(buyer);
    const err = await expectError(svc.claimTask(s, next.task_id, "qwen3:8b", { runner_pubkey_b64: toB64(generateKeypair().publicKey) }), "SELLER_SUSPENDED");
    expect(err.next_action).toBeTruthy();
  });

  it("two sellers racing for one task: exactly one wins", async () => {
    const buyer = await agent("buyer");
    const [a, b] = [await seller(), await seller()];
    const task = await post(buyer);
    const key = () => ({ runner_pubkey_b64: toB64(generateKeypair().publicKey) });
    const outcomes = await Promise.allSettled([svc.claimTask(a, task.task_id, "qwen3:8b", key()), svc.claimTask(b, task.task_id, "qwen3:8b", key())]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const lost = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect((lost.reason as MarketplaceError).code).toBe("CLAIM_CONFLICT");
  });
});

// ---------------------------------------------------------------------------
// expiry and hardening
// ---------------------------------------------------------------------------

describe("expiry and hardening", () => {
  it("a lapsed lease reopens the task and clears the claim's key and envelope", async () => {
    const buyer = await agent("buyer");
    const s = await seller();
    const task = await post(buyer);
    await svc.claimTask(s, task.task_id, "qwen3:8b", { runner_pubkey_b64: toB64(generateKeypair().publicKey) });
    unwrap(await db().from("tasks").update({ lease_expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", task.task_id));

    const swept = await svc.expireStale();
    expect(swept.reopened).toBeGreaterThanOrEqual(1);
    expect(await taskRow(task.task_id)).toMatchObject({ status: "OPEN", claim_id: null, seller_id: null, payload_enc_seller: null, claim_runner_key_id: null, claim_runner_pubkey_b64: null });
  });

  it("a failing expiry never fails the read that triggered it", async () => {
    const buyer = await agent("buyer");
    const task = await post(buyer);
    unwrap(await db().from("tasks").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", task.task_id));
    const spy = vi.spyOn(payments(), "release").mockRejectedValueOnce(new Error("stripe down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const tasks = await svc.listTasksForBuyer((await svc.getAgent(buyer.id))!);
      expect(tasks.find((t) => t.task_id === task.task_id)?.status).toBe("OPEN");
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      warn.mockRestore();
    }
    // the next sweep retries and succeeds
    await svc.expireStale();
    expect((await taskRow(task.task_id)).status).toBe("EXPIRED");
  });

  it("bounds max_price_cents", async () => {
    const buyer = await agent("buyer");
    const err = await expectError(
      svc.postTask(buyer, { prompt: "x", allowed_models: ["qwen3:8b"], max_price_cents: MAX_PRICE_CENTS + 1, rubric: { kind: "contains_text", expected_text: "x" } }),
      "VALIDATION_ERROR",
    );
    expect(err.next_action).toBeTruthy();
  });

  it("list_open_tasks honours its limit", async () => {
    const buyer = await agent("buyer");
    const s = await seller();
    await post(buyer);
    await post(buyer);
    expect((await svc.listOpenTasksFor(s, 1)).tasks).toHaveLength(1);
    expect((await svc.listOpenTasksFor(s, 10_000)).tasks.length).toBeLessThanOrEqual(svc.OPEN_TASKS_MAX_LIMIT);
  });

  it("dashboard counts tasks by status in memory mode", async () => {
    const d = await svc.dashboard();
    expect(d.db).toMatch(/MEMORY/);
    expect(Object.values(d.counts).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});
