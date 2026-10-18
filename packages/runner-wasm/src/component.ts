/**
 * The sandbox entry. Everything here runs inside Wasmtime under Wassette's
 * deny-by-default policy: the only reachable hosts are those granted to this
 * component (Ollama for the seller runner, the judge model API for the judge).
 */
import { restoreRandom } from "./wizer-shim.js";
import { get } from "wasi:config/store@0.2.0-rc.1";
import { keypairFromSecretB64 } from "@atm/crypto";
import { createRunner, runCycle as sellerCycle, safeFailureCode, type Runner, type RunnerHost } from "@atm/runner-core";

const host: RunnerHost = {
  fetch: globalThis.fetch.bind(globalThis),
  getSecret: async (name) => { try { return get(name) ?? undefined; } catch { return undefined; } },
  now: () => Date.now(),
};

let runner: Runner | undefined;
function instance(): Runner {
  restoreRandom();
  // Lazy: Wizer snapshots module top-level at build time, so the keypair must
  // be generated on first call, never at import.
  runner ??= createRunner({
    fetch: globalThis.fetch.bind(globalThis),
    getSecret: async (name) => {
      try { return get(name) ?? undefined; } catch { return undefined; }
    },
    now: () => Date.now(),
  });
  return runner;
}

const fail = (err: unknown): never => {
  throw typeof err === "string" ? err : (err as Error)?.message ?? String(err);
};

export async function getPublicKey(): Promise<string> {
  return JSON.stringify(instance().getPublicKey());
}

export async function runTask(sellerEnvelope: string, opts: string): Promise<string> {
  try {
    return JSON.stringify(await instance().runTask(JSON.parse(sellerEnvelope), JSON.parse(opts)));
  } catch (err) {
    return fail(err);
  }
}

export async function runCycle(opts: string): Promise<string> {
  restoreRandom();
  try { return JSON.stringify(await sellerCycle(host, JSON.parse(opts))); }
  catch (err) { throw safeFailureCode(err); }
}

export async function judgeTask(taskEnvelope: string, resultEnvelope: string, opts: string): Promise<string> {
  try {
    let secret: string | undefined;
    try { secret = get("JUDGE_PRIVATE_KEY_B64") ?? undefined; } catch { secret = undefined; }
    if (!secret) throw new Error("JUDGE_PRIVATE_KEY_B64 is not available inside the judge sandbox");
    const judgeKey = keypairFromSecretB64(secret);
    return JSON.stringify(await instance().judgeTask(JSON.parse(taskEnvelope), JSON.parse(resultEnvelope), JSON.parse(opts), judgeKey));
  } catch (err) {
    return fail(err);
  }
}
