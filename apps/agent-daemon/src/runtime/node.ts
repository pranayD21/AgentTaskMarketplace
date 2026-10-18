/**
 * UNSANDBOXED fallback: runs the runner core in this Node process. Everything
 * it does is visible to the host. Labelled as such wherever it appears.
 */
import { keypairFromSecretB64, type Keypair } from "@atm/crypto";
import { createRunner, type Runner } from "@atm/runner-core";
import type { Runtime, RuntimeInfo } from "./types.js";

export class NodeRuntime implements Runtime {
  private readonly runner: Runner;
  private readonly judgeKey: Keypair | null;

  constructor(judgePrivateKeyB64?: string) {
    this.judgeKey = judgePrivateKeyB64 ? keypairFromSecretB64(judgePrivateKeyB64) : null;
    this.runner = createRunner(
      { fetch: globalThis.fetch.bind(globalThis), getSecret: async (n) => process.env[n], now: () => Date.now() },
      this.judgeKey ?? undefined,
    );
  }
  info(): RuntimeInfo {
    return { runtime: "node-unsandboxed", wasm_sha256: null, wassette_version: null, description: "UNSANDBOXED Node fallback: host can read everything" };
  }
  async getPublicKey() { return this.runner.getPublicKey(); }
  async runTask(envelope: Parameters<Runner["runTask"]>[0], opts: Parameters<Runner["runTask"]>[1]) { return this.runner.runTask(envelope, opts); }
  async judgeTask(t: Parameters<Runner["judgeTask"]>[0], r: Parameters<Runner["judgeTask"]>[1], opts: Parameters<Runner["judgeTask"]>[2]) {
    if (!this.judgeKey) throw new Error("JUDGE_PRIVATE_KEY_B64 is required for the judge role");
    return this.runner.judgeTask(t, r, opts, this.judgeKey);
  }
  async close() {}
}
