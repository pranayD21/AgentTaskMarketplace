import type { Envelope, JudgeTaskOutput, KeyDescriptor, RunTaskOutput } from "@atm/shared";
import type { JudgeCycleOpts, JudgeCycleOutput, JudgeTaskOpts, RunTaskOpts } from "@atm/runner-core";

export interface RuntimeInfo {
  runtime: "wassette" | "node-unsandboxed";
  wasm_sha256: string | null;
  wassette_version: string | null;
  description: string;
}

/** What the daemon needs from an execution environment; the sandbox boundary is behind this. */
export interface Runtime {
  info(): RuntimeInfo;
  getPublicKey(): Promise<KeyDescriptor>;
  runTask(envelope: Envelope, opts: RunTaskOpts): Promise<RunTaskOutput>;
  judgeTask(taskEnvelope: Envelope, resultEnvelope: Envelope, opts: JudgeTaskOpts): Promise<JudgeTaskOutput>;
  /** fetch_review_package → judge → submit_verdict in one runner call (the runner talks to the marketplace itself). */
  judgeCycle(opts: JudgeCycleOpts): Promise<JudgeCycleOutput>;
  close(): Promise<void>;
}
