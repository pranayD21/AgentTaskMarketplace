/** What a runtime reports to the live view. Kept import-free so runtimes depend on the shape only. */
export interface VmStart {
  role: "seller" | "judge";
  runtime: "wassette" | "node-unsandboxed";
  wassette_version: string | null;
  wasm_sha256: string | null;
  network: string[];
  env: string[];
}

export type VmState = "booting" | "ready" | "busy" | "closed" | "crashed";

export interface SandboxObserver {
  /** A new sandbox instance (one `wassette run` process) is starting; returns its id. */
  vmStarted(info: VmStart): string;
  vmUpdate(vm: string, patch: { state?: VmState; pid?: number | null; component?: string }): void;
  /** One MCP call into the instance (load-component, grants, run-cycle, ...). */
  step(vm: string, name: string, phase: "start" | "end", detail?: Record<string, unknown>): void;
  stderr(vm: string, line: string): void;
  vmClosed(vm: string, reason: string): void;
}
