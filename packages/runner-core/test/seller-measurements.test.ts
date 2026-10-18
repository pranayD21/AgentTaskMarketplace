import { expect, it } from "vitest";
import { measuredCycle, modelCanary, safeSellerUsage, type RunnerHost } from "../src/index.js";
import { ollamaUsage } from "../src/seller-measurements.js";
import { fixture } from "./marketplace-fixture.js";

const opts = { marketplace_url: "http://marketplace/mcp", ollama_url: "http://ollama", task_id: "task_fixture", model_id: "qwen3:8b", max_runtime_s: 180 };
const raw = { prompt_eval_count: 12, eval_count: 2, load_duration: 20_000_000, prompt_eval_duration: 30_000_000, eval_duration: 40_000_000, total_duration: 100_000_000 };
const host = (fetcher: typeof fetch): RunnerHost => ({ fetch: fetcher, now: Date.now, getSecret: async () => "test-seller" });

it("converts provider nanoseconds to milliseconds and excludes private fields", () => {
  expect(ollamaUsage({ ...raw, message: { content: "PRIVATE" }, prompt: "PRIVATE" })).toEqual({ source: "ollama", input_tokens: 12, output_tokens: 2, cached_input_tokens: null, load_duration_ms: 20, prompt_eval_duration_ms: 30, eval_duration_ms: 40, total_duration_ms: 100 });
  expect(JSON.stringify(safeSellerUsage({ ...ollamaUsage(raw), answer: "PRIVATE" }))).not.toContain("PRIVATE");
  expect(ollamaUsage({ eval_count: -1, prompt_eval_count: 1.5, load_duration: Infinity })).toMatchObject({ output_tokens: null, input_tokens: null, load_duration_ms: null, eval_duration_ms: null });
  expect(safeSellerUsage(null)).toBeNull();
});

it.each([undefined, "submit_result"])("preserves measured usage when final submission is %s", async (fail) => {
  const service = fixture({ fail });
  const fetcher: typeof fetch = async (url, init) => {
    const response = await service.fetch(url, init);
    return String(url).endsWith("/api/chat") ? Response.json({ ...await response.json(), ...raw }) : response;
  };
  const result = await measuredCycle(host(fetcher), opts);
  expect(result.ok).toBe(!fail);
  expect(result.seller_usage).toMatchObject({ input_tokens: 12, output_tokens: 2, total_duration_ms: 100 });
  expect(JSON.stringify(result)).not.toMatch(/Paris|PRIVATE|France|ciphertext/);
  if (!result.ok) expect(result.error_code).toBe("LEASE_EXPIRED");
});

it("does not manufacture zero usage for an interrupted provider call", async () => {
  const result = await measuredCycle(host(fixture({ fail: "ollama" }).fetch), opts);
  expect(result).toEqual({ ok: false, error_code: "OLLAMA_HTTP_500", seller_usage: null });
});

it.each(["4", "wrong"])("canary uses only a fixed synthetic prompt and returns a boolean for %s", async (answer) => {
  const urls: string[] = [];
  const fake: typeof fetch = async (url, init) => {
    urls.push(String(url));
    if (String(url).endsWith("/api/tags")) return Response.json({ models: [{ name: "qwen3:8b" }] });
    const request = JSON.parse(String(init?.body));
    expect(request.messages[1].content).toBe("What is 2 + 2? Reply with the single digit only.");
    expect(request.options.num_predict).toBe(8);
    return Response.json({ ...raw, message: { content: answer } });
  };
  const result = await modelCanary(host(fake), { ollama_url: "http://ollama", model_id: "qwen3:8b" });
  expect(result.passed).toBe(answer === "4");
  expect(result.seller_usage?.input_tokens).toBe(12);
  expect(urls).toEqual(["http://ollama/api/tags", "http://ollama/api/chat"]);
  expect(Object.keys(result).sort()).toEqual(["passed", "runtime_ms", "seller_usage"]);
});
