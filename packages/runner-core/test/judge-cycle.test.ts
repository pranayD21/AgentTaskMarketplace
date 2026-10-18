import { describe, expect, it } from "vitest";
import { commitment, generateKeypair, keyDescriptor, openJson, seal, sealJson, toB64 } from "@atm/crypto";
import type { Envelope } from "@atm/shared";
import { judgeCycle, PUBLIC_REASON, safeFailureCode, type JudgeCycleOpts, type RunnerHost } from "../src/index.js";

const MARKER = "PRIVATE-MARKER-7f3a";
const fast: Partial<JudgeCycleOpts> = { anthropic_url: "http://anthropic", retry_backoff_ms: 1, model_timeout_ms: 50 };
const opts: JudgeCycleOpts = { marketplace_url: "http://marketplace/mcp", ...fast };

type Provider = (call: number, body: { messages: { content: string }[] }) => Response | Promise<Response>;
const reply = (text: string) => Response.json({ model: "claude-test", stop_reason: "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 0 } });

/**
 * Synthetic marketplace with one SUBMITTED task. The package is served until a
 * verdict is submitted, like the server's JUDGING → SUBMITTED requeue.
 */
function judgeFixture(o: { answer?: string; rubric?: "contains" | "llm"; tamper?: "commitment" | "envelope"; empty?: boolean; provider?: Provider } = {}) {
  const judge = generateKeypair(), buyer = generateKeypair();
  const judgeKey = keyDescriptor("judge-test", judge.publicKey), buyerKey = keyDescriptor("buyer-test", buyer.publicKey);
  const result = { answer: o.answer ?? "Paris", task_id: "task_fixture", claim_id: "claim_1", model_id: "qwen3:8b", salt_b64: toB64(new Uint8Array(32)) };
  const c = commitment(result);
  const calls: string[] = [];
  const verdicts: Record<string, unknown>[] = [];
  let providerCalls = 0;
  const rubric = o.rubric === "llm" ? { kind: "llm_rubric", criteria: `Names the capital ${MARKER}` } : { kind: "contains_text", expected_text: "Paris" };
  const pkg = {
    task_id: "task_fixture", result_id: "result_fixture", claim_id: "claim_1", seller_id: "seller_x", model_id: "qwen3:8b", max_runtime_s: 180,
    payload_enc_judge: sealJson(judgeKey, { task_id: "task_fixture", prompt: `Capital of France? ${MARKER}`, rubric }),
    result_enc_judge: o.tamper === "envelope" ? seal(keyDescriptor("other", generateKeypair().publicKey), c.bytes) : seal(judgeKey, c.bytes),
    commitment_sha256: o.tamper === "commitment" ? "0".repeat(64) : c.sha256_hex,
    buyer_public_key: buyerKey,
  };
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes("/v1/messages")) {
      providerCalls++;
      if (!o.provider) throw new Error("no provider in this test");
      return o.provider(providerCalls, JSON.parse(String(init?.body)));
    }
    const req = JSON.parse(String(init?.body)) as { id?: number; method: string; params: { name?: string; arguments?: Record<string, unknown> } };
    if (req.method === "notifications/initialized") return new Response(null, { status: 202 });
    const ok = (value: unknown) => Response.json({ jsonrpc: "2.0", id: req.id, result: value }, { headers: { "mcp-session-id": "s" } });
    if (req.method === "initialize") return ok({ protocolVersion: "2025-06-18" });
    const name = req.params.name!;
    calls.push(name);
    const text = (v: unknown) => ok({ content: [{ type: "text", text: JSON.stringify(v) }] });
    if (name === "fetch_review_package") return text({ package: o.empty || verdicts.length ? null : pkg, judge_key_id: "judge-test" });
    if (name === "submit_verdict") {
      const v = req.params.arguments!;
      verdicts.push(v);
      return text({ idempotent: false, seller_status: v.verdict === "APPROVE" ? "ACTIVE" : "SUSPENDED", settlement: { seller_payout_cents: v.verdict === "APPROVE" ? 60 : 0, note: null } });
    }
    throw new Error(`UNKNOWN_TOOL_${name}`);
  }) as typeof globalThis.fetch;
  const secrets: Record<string, string | undefined> = { AGENT_API_KEY: "atm_sk_judge", JUDGE_PRIVATE_KEY_B64: toB64(judge.secretKey), ANTHROPIC_API_KEY: o.provider ? "test" : undefined };
  const host = (overrides: Record<string, string | undefined> = {}): RunnerHost => ({ fetch, now: () => Date.now(), getSecret: async (n) => (n in overrides ? overrides[n] : secrets[n]) });
  return { host, calls, verdicts, buyer, providerCalls: () => providerCalls };
}

const replacementOf = (f: ReturnType<typeof judgeFixture>) => openJson(f.buyer, f.verdicts[0]!.replacement_enc_buyer as Envelope);

describe("judge cycle", () => {
  it("returns idle when nothing is waiting", async () => {
    const f = judgeFixture({ empty: true });
    expect(await judgeCycle(f.host(), opts)).toEqual({ idle: true });
    expect(f.calls).toEqual(["fetch_review_package"]);
  });

  it("fetches, verifies, grades and submits APPROVE in one call", async () => {
    const f = judgeFixture();
    const out = await judgeCycle(f.host(), opts);
    expect(out).toMatchObject({ idle: false, deferred: false, verdict: "APPROVE", reason_code: "RUBRIC_MATCH", replacement_status: "not_needed", seller_payout_cents: 60, usage: [] });
    expect(f.calls).toEqual(["fetch_review_package", "submit_verdict"]);
    expect(JSON.stringify(out)).not.toContain("Paris");
  });

  it("fails closed with a code when a secret is missing", async () => {
    const f = judgeFixture();
    await expect(judgeCycle(f.host({ AGENT_API_KEY: undefined }), opts)).rejects.toThrow("MISSING_AGENT_API_KEY");
    expect(safeFailureCode(await judgeCycle(f.host({ JUDGE_PRIVATE_KEY_B64: undefined }), opts).catch((e) => e))).toBe("MISSING_JUDGE_PRIVATE_KEY");
    expect(f.calls).toEqual([]);
  });
});

describe("J1: public reasons are fixed per reason code", () => {
  it("never copies the judge model's text or the task into reason_public", async () => {
    const f = judgeFixture({ rubric: "llm", provider: () => reply(`{"score": 0.2, "pass": false, "reason": "Quoting ${MARKER} from the task"}`) });
    const out = await judgeCycle(f.host(), opts);
    expect(out).toMatchObject({ verdict: "REJECT", reason_code: "LLM_RUBRIC_FAIL", reason_public: PUBLIC_REASON.LLM_RUBRIC_FAIL });
    const { replacement_enc_buyer: _sealed, ...publicArgs } = f.verdicts[0]!;
    expect(JSON.stringify(publicArgs)).not.toContain(MARKER);
    expect(JSON.stringify(out)).not.toContain(MARKER);
  });

  it("keeps provider error bodies out of every output", async () => {
    const f = judgeFixture({ rubric: "llm", provider: () => new Response(`upstream echo: ${MARKER}`, { status: 503 }) });
    const out = await judgeCycle(f.host(), { ...opts, max_attempts: 2 });
    expect(JSON.stringify(out)).not.toContain(MARKER);
  });

  it("uses only fixed text for every reason code", () => {
    for (const text of Object.values(PUBLIC_REASON)) expect(text).toMatch(/^[A-Za-z' ,.;]+$/);
  });
});

describe("J2: judge infrastructure failures are not seller rejections", () => {
  it.each([
    ["503", () => new Response("down", { status: 503 }), "JUDGE_PROVIDER_HTTP_503"],
    ["429", () => new Response("slow down", { status: 429 }), "JUDGE_PROVIDER_HTTP_429"],
    ["timeout", () => new Promise<Response>(() => {}), "JUDGE_MODEL_TIMEOUT"],
    ["malformed", () => reply("I think it is fine"), "JUDGE_MALFORMED_RESPONSE"],
    ["network", () => { throw new TypeError("fetch failed"); }, "JUDGE_PROVIDER_UNREACHABLE"],
  ] as [string, Provider, string][])("%s: bounded retries, then deferred with no verdict", async (_name, provider, code) => {
    const f = judgeFixture({ rubric: "llm", provider });
    const out = await judgeCycle(f.host(), { ...opts, max_attempts: 3 });
    expect(out).toMatchObject({ idle: false, deferred: true, task_id: "task_fixture", failure_code: code });
    expect(f.calls).not.toContain("submit_verdict"); // no strike, no settlement
    expect(f.providerCalls()).toBe(3);
    if (!out.idle && out.deferred) expect(out.usage.map((u) => u.outcome)).toEqual([code, code, code]);
  });

  it("does not retry a refusal, and still submits nothing", async () => {
    const f = judgeFixture({ rubric: "llm", provider: () => Response.json({ stop_reason: "refusal", content: [] }) });
    expect(await judgeCycle(f.host(), opts)).toMatchObject({ deferred: true, failure_code: "JUDGE_PROVIDER_REFUSAL" });
    expect(f.providerCalls()).toBe(1);
    expect(f.calls).not.toContain("submit_verdict");
  });

  it("recovers within the retry budget", async () => {
    const f = judgeFixture({ rubric: "llm", provider: (n) => (n < 3 ? new Response("down", { status: 503 }) : reply('{"score": 1, "pass": true}')) });
    const out = await judgeCycle(f.host(), { ...opts, max_attempts: 3 });
    expect(out).toMatchObject({ deferred: false, verdict: "APPROVE", reason_code: "LLM_RUBRIC_PASS" });
    if (!out.idle && !out.deferred) expect(out.usage.map((u) => u.outcome)).toEqual(["JUDGE_PROVIDER_HTTP_503", "JUDGE_PROVIDER_HTTP_503", "ok"]);
  });

  it("completes on a later round after the provider recovers, with exactly one verdict", async () => {
    let up = false;
    const f = judgeFixture({ rubric: "llm", provider: () => (up ? reply('{"score": 0.9, "pass": true}') : new Response("down", { status: 503 })) });
    expect(await judgeCycle(f.host(), { ...opts, max_attempts: 2 })).toMatchObject({ deferred: true });
    up = true;
    expect(await judgeCycle(f.host(), { ...opts, max_attempts: 2 })).toMatchObject({ deferred: false, verdict: "APPROVE" });
    expect(f.verdicts).toHaveLength(1);
  });

  it("records usage metadata per model call, unknowns as null", async () => {
    const f = judgeFixture({ rubric: "llm", provider: () => reply('{"score": 1, "pass": true}') });
    const out = await judgeCycle(f.host(), opts);
    if (out.idle) throw new Error("expected work");
    expect(out.usage).toEqual([{ purpose: "grade", attempt: 1, model: "claude-test", outcome: "ok", duration_ms: expect.any(Number), input_tokens: 11, output_tokens: 7, cache_creation_input_tokens: null, cache_read_input_tokens: 0 }]);
  });
});

describe("J3: every rejection reports replacement availability", () => {
  const answer: Provider = () => reply("Paris");

  it.each([
    ["commitment mismatch", { tamper: "commitment" as const }],
    ["unreadable result envelope", { tamper: "envelope" as const }],
    ["empty answer", { answer: "   " }],
    ["rubric mismatch", { answer: "Lyon" }],
  ])("%s → REJECT with a replacement sealed to the buyer", async (_name, o) => {
    const f = judgeFixture({ ...o, provider: answer });
    const out = await judgeCycle(f.host(), opts);
    expect(out).toMatchObject({ deferred: false, verdict: "REJECT", replacement_status: "available", replacement_failure_code: null });
    expect(replacementOf(f)).toEqual({ answer: "Paris", produced_by: "judge" });
  });

  it("reports unavailable (with a code) when the provider stays down, keeping the original reason", async () => {
    const f = judgeFixture({ tamper: "commitment", provider: () => new Response("down", { status: 503 }) });
    const out = await judgeCycle(f.host(), { ...opts, max_attempts: 2 });
    expect(out).toMatchObject({ verdict: "REJECT", reason_code: "COMMITMENT_MISMATCH", replacement_status: "unavailable", replacement_failure_code: "JUDGE_PROVIDER_HTTP_503" });
    expect(f.verdicts[0]!.replacement_enc_buyer).toBeUndefined();
    expect(f.verdicts).toHaveLength(1);
  });

  it("retries the replacement within its budget", async () => {
    const f = judgeFixture({ answer: "Lyon", provider: (n) => (n === 1 ? new Response("down", { status: 500 }) : reply("Paris")) });
    expect(await judgeCycle(f.host(), opts)).toMatchObject({ replacement_status: "available" });
    expect(replacementOf(f)).toEqual({ answer: "Paris", produced_by: "judge" });
  });

  it("reports unavailable without a model key", async () => {
    const f = judgeFixture({ answer: "Lyon" });
    expect(await judgeCycle(f.host(), opts)).toMatchObject({ verdict: "REJECT", reason_code: "RUBRIC_MISMATCH", replacement_status: "unavailable", replacement_failure_code: "MISSING_ANTHROPIC_API_KEY" });
  });
});
