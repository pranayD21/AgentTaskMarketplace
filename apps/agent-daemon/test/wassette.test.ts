import http from "node:http";
import { once } from "node:events";
import { expect, it } from "vitest";
import { fixture } from "../../../packages/runner-core/test/marketplace-fixture.js";
import { WassetteRuntime } from "../src/runtime/wassette.js";
import { FetchMarketplace } from "@atm/runner-core";
import { recoverClaim } from "../src/seller.js";

async function serve(handler: typeof fetch, hostname = "127.0.0.1") {
  const server = http.createServer(async (req, res) => {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const response = await handler(`http://${req.headers.host}${req.url}`, {
        method: req.method, headers: req.headers as Record<string, string>, ...(body ? { body } : {}),
      });
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(await response.text());
    } catch { res.writeHead(500); res.end("fixture failed"); }
  });
  server.listen(0); await once(server, "listening");
  return { url: `http://${hostname}:${(server.address() as { port: number }).port}`, close: async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
}

it.skipIf(!process.env.ATM_TEST_WASSETTE)("runs fresh-instance cycles, denies Ollama, reconnects and resolves a seller race in real Wassette", async () => {
  const service = fixture({ sse: true });
  const marketplace = await serve(service.fetch);
  const ollama = await serve(service.fetch, "localhost");
  const config = { apiKey: "fixture-seller", marketplaceUrl: `${marketplace.url}/mcp`, ollamaUrl: ollama.url };
  const opts = { marketplace_url: config.marketplaceUrl, ollama_url: ollama.url, task_id: "task_fixture", model_id: "qwen3:8b", max_runtime_s: 180 };
  const runtime = new WassetteRuntime("seller", undefined, config);
  const denied = new WassetteRuntime("seller", undefined, { ...config, denyOllama: true });
  const competitor = new WassetteRuntime("seller", undefined, { ...config, apiKey: "fixture-seller-2" });
  try {
    const first = await runtime.runCycle(opts);
    expect(service.summary().outputVerified).toBe(true);
    expect(first.seller_usage).toMatchObject({ source: "ollama", output_tokens: 2, input_tokens: null });
    service.reset();
    const second = await runtime.runCycle(opts);
    expect(first.key_id).not.toBe(second.key_id);
    service.reset();
    const callsBefore = service.calls.filter((c) => c === "ollama").length;
    await expect(denied.runCycle(opts)).rejects.toThrow();
    expect(service.calls.filter((c) => c === "ollama")).toHaveLength(callsBefore);
    expect(service.summary().state).toBe("OPEN");
    service.setDelay(500);
    const beforeCrash = service.calls.filter((c) => c === "ollama").length;
    const interrupted = runtime.runCycle(opts).catch((error) => error);
    for (let i = 0; i < 200 && service.calls.filter((c) => c === "ollama").length === beforeCrash; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(service.calls.filter((c) => c === "ollama").length).toBe(beforeCrash + 1);
    // Kill only the child owned by this runtime while a request is in flight.
    process.kill((runtime as unknown as { transport: { pid: number } }).transport.pid, "SIGKILL");
    expect(await interrupted).toBeInstanceOf(Error);
    await recoverClaim(new FetchMarketplace(config.marketplaceUrl, config.apiKey, fetch), opts.task_id, () => {});
    expect(service.summary().state).toBe("OPEN");
    service.setDelay(0);
    await runtime.runCycle(opts);
    expect(service.summary().state).toBe("SUBMITTED");
    service.reset();
    service.setDelay(100);
    await expect(runtime.runCycle({ ...opts, max_runtime_s: 0.01 })).rejects.toThrow("TASK_TIMEOUT");
    expect(service.summary().state).toBe("OPEN");
    service.setDelay(0);
    service.reset();
    const raced = await Promise.allSettled([runtime.runCycle(opts), competitor.runCycle(opts)]);
    expect(raced.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((raced.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "CLAIM_CONFLICT" });
    console.log("Wassette evidence: fresh per-call keys; verified result bytes; Ollama denial and release; killed child and reconnect; timeout release; one race winner.");
  } finally { await runtime.close(); await denied.close(); await competitor.close(); await marketplace.close(); await ollama.close(); }
}, 180_000);


it.skipIf(!process.env.ATM_TEST_WASSETTE)("keeps inference usage after a failed submission and runs a private canary in real Wassette", async () => {
  const service = fixture({ fail: "submit_result" });
  const marketplace = await serve(service.fetch);
  let canary = false;
  const ollama = await serve((async (url: unknown, init?: RequestInit) => {
    if (String(url).endsWith("/api/chat")) return Response.json({ message: { content: canary ? "4" : "Paris" }, eval_count: 2, prompt_eval_count: 10, total_duration: 1_000_000 });
    return service.fetch(url as string, init);
  }) as typeof fetch, "localhost");
  const runtime = new WassetteRuntime("seller", undefined, { apiKey: "fixture", marketplaceUrl: `${marketplace.url}/mcp`, ollamaUrl: ollama.url });
  try {
    await expect(runtime.runCycle({ marketplace_url: `${marketplace.url}/mcp`, ollama_url: ollama.url, task_id: "task_fixture", model_id: "qwen3:8b", max_runtime_s: 180 }))
      .rejects.toMatchObject({ code: "LEASE_EXPIRED", seller_usage: { input_tokens: 10, output_tokens: 2, total_duration_ms: 1 } });
    canary = true;
    const calls = service.calls.length;
    expect(await runtime.modelCanary({ ollama_url: ollama.url, model_id: "qwen3:8b" })).toMatchObject({ passed: true, seller_usage: { input_tokens: 10 } });
    expect(service.calls).toHaveLength(calls);
  } finally { await runtime.close(); await marketplace.close(); await ollama.close(); }
}, 90_000);
