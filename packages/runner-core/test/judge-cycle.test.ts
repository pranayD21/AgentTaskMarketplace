import { describe, expect, it } from "vitest";
import { commitment, generateKeypair, keyDescriptor, openJson, seal, sealJson, toB64 } from "@atm/crypto";
import type { Envelope } from "@atm/shared";
import { judgeCycle, safeFailureCode, type JudgeCycleOpts, type RunnerHost } from "../src/index.js";

const opts: JudgeCycleOpts = { marketplace_url: "http://marketplace/mcp" };

/** Synthetic marketplace with one SUBMITTED task; contains_text rubric, so no model API. */
function judgeFixture(o: { answer?: string; tamper?: boolean; empty?: boolean } = {}) {
  const judge = generateKeypair(), buyer = generateKeypair();
  const judgeKey = keyDescriptor("judge-test", judge.publicKey), buyerKey = keyDescriptor("buyer-test", buyer.publicKey);
  const result = { answer: o.answer ?? "Paris", task_id: "task_fixture", claim_id: "claim_1", model_id: "qwen3:8b", salt_b64: toB64(new Uint8Array(32)) };
  const c = commitment(result);
  const calls: string[] = [];
  let submitted: Record<string, unknown> | undefined;
  const pkg = {
    task_id: "task_fixture", result_id: "result_fixture", claim_id: "claim_1", seller_id: "seller_x", model_id: "qwen3:8b", max_runtime_s: 180,
    payload_enc_judge: sealJson(judgeKey, { task_id: "task_fixture", prompt: "Capital of France?", rubric: { kind: "contains_text", expected_text: "Paris" } }),
    result_enc_judge: seal(judgeKey, c.bytes),
    commitment_sha256: o.tamper ? "0".repeat(64) : c.sha256_hex,
    buyer_public_key: buyerKey,
  };
  const fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body)) as { id?: number; method: string; params: { name?: string; arguments?: Record<string, unknown> } };
    if (req.method === "notifications/initialized") return new Response(null, { status: 202 });
    const ok = (value: unknown) => Response.json({ jsonrpc: "2.0", id: req.id, result: value }, { headers: { "mcp-session-id": "s" } });
    if (req.method === "initialize") return ok({ protocolVersion: "2025-06-18" });
    const name = req.params.name!;
    calls.push(name);
    const text = (v: unknown) => ok({ content: [{ type: "text", text: JSON.stringify(v) }] });
    if (name === "fetch_review_package") return text({ package: o.empty || submitted ? null : pkg, judge_key_id: "judge-test" });
    if (name === "submit_verdict") {
      submitted = req.params.arguments;
      return text({ idempotent: false, seller_status: submitted!.verdict === "APPROVE" ? "ACTIVE" : "SUSPENDED", settlement: { seller_payout_cents: submitted!.verdict === "APPROVE" ? 60 : 0, note: null } });
    }
    throw new Error(`UNKNOWN_TOOL_${name}`);
  }) as typeof globalThis.fetch;
  const secrets: Record<string, string> = { AGENT_API_KEY: "atm_sk_judge", JUDGE_PRIVATE_KEY_B64: toB64(judge.secretKey) };
  const host = (overrides: Record<string, string | undefined> = {}): RunnerHost => ({ fetch, now: () => Date.now(), getSecret: async (n) => (n in overrides ? overrides[n] : secrets[n]) });
  return { host, calls, submitted: () => submitted, buyer };
}

describe("judge cycle", () => {
  it("returns idle when nothing is waiting", async () => {
    const f = judgeFixture({ empty: true });
    expect(await judgeCycle(f.host(), opts)).toEqual({ idle: true });
    expect(f.calls).toEqual(["fetch_review_package"]);
  });

  it("fetches, verifies, grades and submits APPROVE in one call", async () => {
    const f = judgeFixture();
    const out = await judgeCycle(f.host(), opts);
    expect(out).toMatchObject({ idle: false, task_id: "task_fixture", verdict: "APPROVE", reason_code: "RUBRIC_MATCH", seller_payout_cents: 60 });
    expect(f.calls).toEqual(["fetch_review_package", "submit_verdict"]);
    expect(JSON.stringify(out)).not.toContain("Paris");
  });

  it("rejects a result that does not match the submitted commitment", async () => {
    const f = judgeFixture({ tamper: true });
    expect(await judgeCycle(f.host(), opts)).toMatchObject({ verdict: "REJECT", reason_code: "COMMITMENT_MISMATCH", seller_status: "SUSPENDED" });
  });

  it("rejects a wrong answer (no replacement without a model key)", async () => {
    const f = judgeFixture({ answer: "Lyon" });
    expect(await judgeCycle(f.host({ ANTHROPIC_API_KEY: undefined }), opts)).toMatchObject({ verdict: "REJECT", reason_code: "RUBRIC_MISMATCH" });
    expect(f.submitted()?.replacement_enc_buyer).toBeUndefined();
  });

  it("produces a replacement sealed to the buyer when the model API answers", async () => {
    const f = judgeFixture({ answer: "Lyon" });
    const base = f.host();
    const host: RunnerHost = {
      ...base,
      getSecret: async (n) => (n === "ANTHROPIC_API_KEY" ? "test" : base.getSecret(n)),
      fetch: (async (input: string | URL | Request, init?: RequestInit) =>
        String(input).includes("/v1/messages") ? Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: "Paris" }] }) : base.fetch(input, init)) as typeof fetch,
    };
    await judgeCycle(host, { ...opts, anthropic_url: "http://anthropic" });
    expect(openJson(f.buyer, f.submitted()!.replacement_enc_buyer as Envelope)).toEqual({ answer: "Paris", produced_by: "judge" });
  });

  it("fails closed with a code when a secret is missing", async () => {
    const f = judgeFixture();
    await expect(judgeCycle(f.host({ AGENT_API_KEY: undefined }), opts)).rejects.toThrow("MISSING_AGENT_API_KEY");
    const err = await judgeCycle(f.host({ JUDGE_PRIVATE_KEY_B64: undefined }), opts).catch((e) => e);
    expect(safeFailureCode(err)).toBe("MISSING_JUDGE_PRIVATE_KEY");
    expect(f.calls).toEqual([]);
  });
});
