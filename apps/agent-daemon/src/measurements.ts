import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { safeSellerUsage, safeFailureCode, type SellerUsage } from "@atm/runner-core";
import type { RuntimeInfo } from "./runtime/types.js";

export interface Attempt { kind: "task_attempt" | "model_canary"; model_id: string; task_id?: string; model_digest?: string; job_id?: string | null; part_key?: string | null; task_attempt?: number | null }
export interface AttemptResult {
  status: "submitted" | "failed" | "passed";
  claim_id?: string; result_id?: string; runtime_ms?: number;
  seller_usage?: SellerUsage | null; error_code?: string;
}
export interface MeasurementOptions {
  file: string; computerId: string; sellerId: string | null; estimatedWatts?: number;
  runtime: () => RuntimeInfo; warn: (message: string) => void;
}
const safeId = (v: unknown): string | null => typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v) ? v : null;
const digest = (v: unknown): string | null => typeof v === "string" && /^(sha256:)?[a-f0-9]{64}$/.test(v) ? v : null;
const number = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

/** Local JSONL only. Unknown usage stays null; failures get their own rows. */
export class MeasurementRecorder {
  private warned = false;
  constructor(private readonly opts: MeasurementOptions) {
    if (!/^[ABCDE]$/.test(opts.computerId)) throw new Error("computer-id must be A, B, C, D or E");
    if (opts.estimatedWatts !== undefined && (!Number.isFinite(opts.estimatedWatts) || opts.estimatedWatts <= 0)) throw new Error("estimated-watts must be a positive number");
    fs.mkdirSync(path.dirname(path.resolve(opts.file)), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(opts.file, "a", 0o600);
    fs.fchmodSync(fd, 0o600); fs.closeSync(fd);
  }
  private write(row: Record<string, unknown>) {
    try { fs.appendFileSync(this.opts.file, `${JSON.stringify(row)}\n`, { mode: 0o600 }); }
    catch {
      // Measurement failure must never turn a submitted result into a task retry.
      if (!this.warned) { this.warned = true; this.opts.warn("MEASUREMENT_WRITE_FAILED: usage coverage is incomplete"); }
    }
  }
  begin(attempt: Attempt): (result: AttemptResult) => void {
    const start = Date.now();
    const tick = performance.now();
    const info = this.opts.runtime();
    const base = {
      schema_version: 1, attempt_id: randomUUID(), kind: attempt.kind, computer_id: this.opts.computerId,
      seller_id: safeId(this.opts.sellerId), task_id: safeId(attempt.task_id),
      job_id: safeId(attempt.job_id), part_key: typeof attempt.part_key === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(attempt.part_key) ? attempt.part_key : null,
      task_attempt: Number.isSafeInteger(attempt.task_attempt) && (attempt.task_attempt ?? 0) >= 1 ? attempt.task_attempt : null,
      model_id: /^[A-Za-z0-9._:/-]{1,150}$/.test(attempt.model_id) ? attempt.model_id : null,
      model_digest: digest(attempt.model_digest), runtime: info.runtime, wassette_version: info.wassette_version && /^[0-9.]{1,30}$/.test(info.wassette_version) ? info.wassette_version : null, component_sha256: digest(info.wasm_sha256),
      started_at: new Date(start).toISOString(),
      hardware: { platform: os.platform(), arch: os.arch(), cpu_model: os.cpus()[0]?.model ?? null, cpu_count: os.cpus().length, memory_bytes: os.totalmem(), node_version: process.versions.node },
      provenance: "local_host_reported_not_attested",
    };
    this.write({ ...base, event: "started" });
    let finished = false;
    return (result) => {
      if (finished) return;
      finished = true;
      const elapsed = Math.max(0, performance.now() - tick);
      const usage = safeSellerUsage(result.seller_usage);
      const watts = this.opts.estimatedWatts ?? null;
      this.write({ ...base, event: "finished", finished_at: new Date().toISOString(), elapsed_ms: elapsed,
        status: result.status, claim_id: safeId(result.claim_id), result_id: safeId(result.result_id), runtime_ms: number(result.runtime_ms),
        error_code: result.error_code ? safeFailureCode(new Error(result.error_code)) : null,
        seller_usage: usage, usage_complete: Boolean(usage && Object.values(usage).every((v) => v !== null)),
        energy: { method: watts === null ? "not_measured" : "estimated_from_configured_whole_machine_watts",
          estimated_watts: watts, kwh: watts === null ? null : watts * elapsed / 3_600_000_000,
          scope: "attempt_wall_time_including_transport", allocation: "whole_machine_estimate_not_incremental_or_attributed" },
      });
    };
  }
}
