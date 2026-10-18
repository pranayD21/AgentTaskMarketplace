import type { Envelope, JudgeTaskOutput, KeyDescriptor, RunTaskOutput } from "@atm/shared";
import type { JudgeTaskOpts, RunTaskOpts, RunCycleOpts, RunCycleOutput } from "@atm/runner-core";

export interface RuntimeInfo {
  runtime: "wassette" | "node-unsandboxed";
  wasm_sha256: string | null;
  wassette_version: string | null;
  description: string;
}

/** What the daemon needs from an execution environment; the sandbox boundary is behind this. */
export interface Runtime {
  info(): RuntimeInfo;
  prepare?(): Promise<void>;
  runCycle?(opts: RunCycleOpts): Promise<RunCycleOutput>;
  getPublicKey(): Promise<KeyDescriptor>;
  runTask(envelope: Envelope, opts: RunTaskOpts): Promise<RunTaskOutput>;
  judgeTask(taskEnvelope: Envelope, resultEnvelope: Envelope, opts: JudgeTaskOpts): Promise<JudgeTaskOutput>;
  close(): Promise<void>;
}
