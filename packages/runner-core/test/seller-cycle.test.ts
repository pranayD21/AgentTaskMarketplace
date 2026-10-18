import { describe, expect, it } from "vitest";
import { runCycle, safeFailureCode, FetchMarketplace, type RunCycleOpts, type RunnerHost } from "../src/index.js";
import { fixture } from "./marketplace-fixture.js";

const opts: RunCycleOpts = { marketplace_url: "http://marketplace/mcp", ollama_url: "http://ollama", task_id: "task_fixture", model_id: "qwen3:8b", max_runtime_s: 180 };
const host = (fetch: typeof globalThis.fetch, key = "test-seller"): RunnerHost => ({ fetch, now: () => Date.now(), getSecret: async () => key });

describe("seller cycle", () => {
  it.each([false, true])("claims, decrypts and submits with a fresh in-call key; SSE=%s", async (sse) => {
    const server = fixture({ sse });
    const first = await runCycle(host(server.fetch), opts);
    expect(first).toMatchObject({ task_id: opts.task_id, result_id: "result_fixture", tokens_out: 2 });
    expect(server.summary()).toMatchObject({ state: "SUBMITTED", outputVerified: true, result: { answer: "Paris" } });
    expect(JSON.stringify(first)).not.toContain("Paris");
    expect(server.calls).not.toContain("get_recipient_keys");
    server.reset();
    const second = await runCycle(host(server.fetch), opts);
    expect(second.key_id).not.toBe(first.key_id);
  });

  it("supports the old server by registering the same call's key", async () => {
    const server = fixture({ legacy: true });
    await runCycle(host(server.fetch), { ...opts, legacy_registration: { models: [{ model_id: opts.model_id, ask_cents: 60 }], runtime: "wassette" } });
    expect(server.calls.slice(0, 4)).toEqual(["register_seller", "claim_task", "start_task", "get_recipient_keys"]);
    expect(server.summary().outputVerified).toBe(true);
  });

  it("allows exactly one of two sellers to win", async () => {
    const server = fixture();
    const results = await Promise.allSettled([runCycle(host(server.fetch, "seller1"), opts), runCycle(host(server.fetch, "seller2"), opts)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(safeFailureCode(loser.reason)).toBe("CLAIM_CONFLICT");
    expect(server.calls.filter((c) => c === "submit_result")).toHaveLength(1);
    expect(server.calls).not.toContain("release_task");
  });

  it.each([
    [{ missingModel: true }, "MODEL_NOT_INSTALLED"],
    [{ expired: true }, "LEASE_EXPIRED"],
    [{ fail: "start_task" }, "LEASE_EXPIRED"],
    [{ fail: "submit_result" }, "LEASE_EXPIRED"],
    [{ fail: "timeout" }, "TASK_TIMEOUT"],
    [{ fail: "ollama" }, "OLLAMA_HTTP_500"],
  ] as const)("releases after failure: %j", async (failure, code) => {
    const server = fixture(failure);
    let caught: unknown;
    try { await runCycle(host(server.fetch), opts); } catch (e) { caught = e; }
    expect(safeFailureCode(caught)).toBe(code);
    expect(server.calls).toContain("release_task");
    expect(server.summary().state).toBe("OPEN");
    expect(String(caught)).not.toContain("PRIVATE");
  });

  it("stops a suspended seller before inference", async () => {
    const server = fixture({ fail: "claim_task" });
    await expect(runCycle(host(server.fetch), opts)).rejects.toMatchObject({ code: "SELLER_SUSPENDED" });
    expect(server.calls).not.toContain("ollama");
    expect(server.calls).not.toContain("release_task");
  });

  it("keeps remote error messages private", () => expect(safeFailureCode(new Error("secret prompt"))).toBe("RUNNER_FAILED"));

  it("consumes an SSE result without waiting for the stream to end", async () => {
    let cancelled = false;
    const fetcher = async (_url: unknown, init?: RequestInit) => {
      const req = JSON.parse(String(init?.body));
      if (req.method === "notifications/initialized") return new Response(null, { status: 202 });
      const result = req.method === "initialize" ? { protocolVersion: "2025-06-18" } : { structuredContent: { ok: true } };
      const data = new TextEncoder().encode(`: keepalive\n\ndata: ${JSON.stringify({ id: req.id, result })}\n\n`);
      return new Response(new ReadableStream({ start(c) { c.enqueue(data.slice(0, 8)); c.enqueue(data.slice(8)); }, cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } });
    };
    expect(await new FetchMarketplace(opts.marketplace_url, "test", fetcher as typeof fetch).call("hello")).toEqual({ ok: true });
    expect(cancelled).toBe(true);
  });
});
