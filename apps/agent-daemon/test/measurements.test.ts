import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { MeasurementRecorder } from "../src/measurements.js";
const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function recorder(estimatedWatts?: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atm-measurement-test-")); dirs.push(dir);
  const file = path.join(dir, "attempts.jsonl");
  const warn = vi.fn();
  const record = new MeasurementRecorder({ file, computerId: "C", sellerId: "seller_fixture", estimatedWatts, warn,
    runtime: () => ({ runtime: "wassette", wasm_sha256: "a".repeat(64), wassette_version: "test", description: "PRIVATE_NOT_FOR_MEASUREMENTS" }) });
  return { record, file, warn, read: () => fs.readFileSync(file, "utf8").trim().split("\n").map((x) => JSON.parse(x)) };
}
it("records every attempt with unknown usage/energy and no private fields", () => {
  const r = recorder();
  const finish = r.record.begin({ kind: "task_attempt", model_id: "qwen3:8b", task_id: "task_test" });
  finish({ status: "failed", error_code: "PRIVATE sensitive response" });
  finish({ status: "submitted" });
  const rows = r.read();
  expect(rows).toHaveLength(2);
  expect(rows[1]).toMatchObject({ event: "finished", status: "failed", seller_usage: null, usage_complete: false, error_code: "RUNNER_FAILED", energy: { method: "not_measured", kwh: null } });
  expect(rows[0].attempt_id).toBe(rows[1].attempt_id);
  expect(fs.statSync(r.file).mode & 0o777).toBe(0o600);
  expect(fs.readFileSync(r.file, "utf8")).not.toContain("PRIVATE");
});
it("labels whole-machine energy estimates and retains a start row after an unfinished attempt", () => {
  const r = recorder(100);
  vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(3_600_000).mockReturnValue(3_600_000);
  r.record.begin({ kind: "task_attempt", model_id: "qwen3:8b" })({ status: "submitted" });
  r.record.begin({ kind: "task_attempt", model_id: "qwen3:8b" });
  const rows = r.read();
  expect(rows[1].energy).toMatchObject({ method: "estimated_from_configured_whole_machine_watts", kwh: 0.1 });
  expect(rows[2].event).toBe("started");
  expect(rows[2].attempt_id).not.toBe(rows[0].attempt_id);
});
it("does not retry completed work when writing measurement data fails", () => {
  const r = recorder();
  vi.spyOn(fs, "appendFileSync").mockImplementation(() => { throw new Error("disk full"); });
  expect(() => r.record.begin({ kind: "task_attempt", model_id: "qwen3:8b" })({ status: "submitted" })).not.toThrow();
  expect(r.warn).toHaveBeenCalledTimes(1);
});

it.each([false, true])("seller loop writes inference usage across the runtime boundary; submission failure=%s", async (failed) => {
  const { sellerLoop } = await import("../src/seller.js");
  const r = recorder();
  const usage = { source: "ollama" as const, input_tokens: 12, output_tokens: 2, cached_input_tokens: null, total_duration_ms: 100, load_duration_ms: 20, prompt_eval_duration_ms: 30, eval_duration_ms: 40 };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ models: [{ name: "qwen3:8b", digest: "a".repeat(64), size: 100 }] })));
  const calls: string[] = [];
  const mp = {
    sellerKeyMode: async () => "per-claim",
    call: async (name: string) => {
      calls.push(name);
      if (name === "marketplace_info") return { models: [{ model_id: "qwen3:8b" }] };
      if (name === "register_seller") return { seller: { status: "ACTIVE" } };
      if (name === "list_open_tasks") return { tasks: [{ task_id: "task_fixture", eligible_models: ["qwen3:8b"], max_runtime_s: 180, job_id: "job_fixture", part_key: "part.1", attempt: 2, part_label: "PRIVATE_PART_LABEL" }] };
      if (name === "get_task") return { task: { status: "SUBMITTED" } };
      throw new Error("unexpected tool");
    },
  };
  const rt = {
    info: () => ({ runtime: "wassette", wasm_sha256: "a".repeat(64) }),
    runCycle: async () => {
      if (failed) throw Object.assign(new Error("MARKETPLACE_TIMEOUT"), { seller_usage: usage });
      return { task_id: "task_fixture", claim_id: "claim_fixture", result_id: "result_fixture", key_id: "runner_test", runtime_ms: 110, seller_usage: usage };
    },
  };
  try {
    const result = sellerLoop(mp as any, rt as any, { marketplaceUrl: "http://fixture/mcp", ollamaUrl: "http://fixture", pollMs: 5000, askCents: 75, once: true, log: () => {}, measurements: r.record });
    if (failed) await expect(result).rejects.toThrow("MARKETPLACE_TIMEOUT"); else await result;
    expect(r.read()[1]).toMatchObject({ status: failed ? "failed" : "submitted", seller_usage: { input_tokens: 12, output_tokens: 2 }, task_id: "task_fixture", job_id: "job_fixture", part_key: "part.1", task_attempt: 2 });
    expect(fs.readFileSync(r.file, "utf8")).not.toContain("PRIVATE_PART_LABEL");
    expect(calls).not.toContain("release_task");
  } finally { vi.unstubAllGlobals(); }
});
