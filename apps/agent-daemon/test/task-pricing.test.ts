import { afterEach, expect, it, vi } from "vitest";
import { requireTaskPricing, selectOfferedTask, type OfferedTask } from "../src/task-pricing.js";
import { sellerLoop } from "../src/seller.js";

const task = (id: string, price: number | null, model = "qwen3:8b"): OfferedTask => ({ task_id: id, price_cents: price, eligible_models: [model], max_runtime_s: 180 });
afterEach(() => vi.unstubAllGlobals());

it("prefers higher task offers, retaining server order for ties and respecting explicit task assignment", () => {
  const tasks = [task("cheap", 50), task("first", 100), task("second", 100), task("unsupported", 1000, "unavailable")];
  expect(selectOfferedTask(tasks, ["qwen3:8b"])?.task_id).toBe("first");
  expect(selectOfferedTask(tasks, ["qwen3:8b"], "cheap")?.price_cents).toBe(50);
  expect(selectOfferedTask(tasks, ["qwen3:8b"], "unsupported")).toBeUndefined();
});

it("never substitutes a budget, legacy ask or malformed price for the offered payment", () => {
  const tasks = [null, 0, -1, 5.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map((p, i) => ({ ...task(String(i), p), max_price_cents: 100, ask_cents: 75 }));
  expect(selectOfferedTask(tasks, ["qwen3:8b"])).toBeUndefined();
});

it.each([undefined, {}, { pricing: { mode: "seller_quote" } }])("refuses seller-priced servers before advertising or executing: %j", async (info) => {
  expect(() => requireTaskPricing(info)).toThrow("TASK_PRICING_UNSUPPORTED");
  const call = vi.fn(async () => info);
  await expect(sellerLoop({ call } as any, {} as any, { marketplaceUrl: "http://fixture", ollamaUrl: "http://fixture", pollMs: 100, once: true, log: () => {} })).rejects.toThrow("TASK_PRICING_UNSUPPORTED");
  expect(call.mock.calls).toHaveLength(1);
});

it("advertises capabilities without a quote and passes the observed offer into the sandbox", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ models: [{ name: "qwen3:8b", digest: "a".repeat(64) }] })));
  const call = vi.fn(async (name: string, _args?: unknown) => {
    if (name === "marketplace_info") return { models: [], pricing: { mode: "task_offer" } };
    if (name === "register_seller") return { seller: { status: "ACTIVE" } };
    if (name === "list_open_tasks") return { tasks: [task("task_cheap", 50), task("task_high", 100)] };
    throw new Error("UNEXPECTED_TOOL");
  });
  const runCycle = vi.fn(async () => ({ task_id: "task_high", claim_id: "claim_test", result_id: "result_test", price_cents: 100 }));
  const rt = { info: () => ({ runtime: "wassette" }), runCycle };
  await sellerLoop({ call, sellerKeyMode: async () => "per-claim" } as any, rt as any, { marketplaceUrl: "http://fixture", ollamaUrl: "http://fixture", pollMs: 100, once: true, log: () => {} });
  expect(call).toHaveBeenCalledWith("register_seller", { models: [{ model_id: "qwen3:8b", digest: "a".repeat(64) }], runtime: "wassette", runner_wasm_sha256: undefined, wassette_version: undefined });
  expect(runCycle).toHaveBeenCalledWith(expect.objectContaining({ task_id: "task_high", expected_price_cents: 100 }));
});

it("releases a Node claim whose price changed before running the model", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ models: [{ name: "qwen3:8b" }] })));
  const call = vi.fn(async (name: string, _args?: unknown) => {
    if (name === "marketplace_info") return { models: [], pricing: { mode: "task_offer" } };
    if (name === "register_seller") return { seller: { status: "ACTIVE" } };
    if (name === "list_open_tasks") return { tasks: [task("task_test", 100)] };
    if (name === "claim_task") return { claim: { task_id: "task_test", claim_id: "claim_test", price_cents: 75 } };
    if (name === "release_task") return {};
    if (name === "get_task") return { task: { status: "OPEN" } };
    throw new Error("UNEXPECTED_TOOL");
  });
  const runTask = vi.fn();
  const rt = { info: () => ({ runtime: "node-unsandboxed" }), getPublicKey: async () => ({ key_id: "key", public_key_b64: "public" }), runTask };
  await expect(sellerLoop({ call } as any, rt as any, { marketplaceUrl: "http://fixture", ollamaUrl: "http://fixture", pollMs: 100, once: true, log: () => {} })).rejects.toThrow("TASK_PRICE_CHANGED");
  expect(call).toHaveBeenCalledWith("release_task", { task_id: "task_test", claim_id: "claim_test", reason: "TASK_PRICE_CHANGED" });
  expect(runTask).not.toHaveBeenCalled();
});
