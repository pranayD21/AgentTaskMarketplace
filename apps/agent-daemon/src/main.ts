import { readCompute } from "./compute.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { MeasurementRecorder } from "./measurements.js";
import { listOllamaModels } from "./ollama.js";
import { sellerLoop } from "./seller.js";
import { requireTaskPricing } from "./task-pricing.js";
import { safeFailureCode } from "@atm/runner-core";
import { parseArgs } from "node:util";
import { Marketplace } from "./marketplace.js";
import { NodeRuntime } from "./runtime/node.js";
import { lockIdentity, readAgentState, registerSavedAgent } from "./identity.js";
import { requireCompatibleRelease } from "./release.js";
import type { Runtime } from "./runtime/types.js";
import type { LiveView, OpenMode } from "./viewer/server.js";
import type { Tap } from "./viewer/tap.js";

const cliArgs = process.argv.slice(2);
if (cliArgs[0] === "--") cliArgs.shift();
const { values: args } = parseArgs({
  args: cliArgs,
  options: {
    role: { type: "string", default: "seller" },
    runtime: { type: "string", default: process.env.ATM_RUNTIME ?? "wassette" },
    model: { type: "string", multiple: true },
    "ask-cents": { type: "string" }, // Deprecated; accepted only to explain migration to existing scripts.
    "display-name": { type: "string" },
    "poll-ms": { type: "string", default: "5000" },
    "state-file": { type: "string" },
    "task-id": { type: "string" },
    "computer-id": { type: "string" },
    "measurement-file": { type: "string" },
    "estimated-watts": { type: "string" },
    canary: { type: "boolean", default: false },
    "canary-only": { type: "boolean", default: false },
    "register-only": { type: "boolean", default: false },
    "deny-ollama": { type: "boolean", default: false },
    "deny-marketplace": { type: "boolean", default: false },
    once: { type: "boolean", default: false },
    viewer: { type: "boolean", default: process.env.ATM_VIEWER === "1" || process.env.ATM_HUMAN_SELLER_REQUIRED === "1" },
    "viewer-port": { type: "string", default: process.env.ATM_VIEWER_PORT ?? (process.env.ATM_HUMAN_SELLER_REQUIRED === "1" ? "0" : "4700") },
    "viewer-open": { type: "string", default: process.env.ATM_VIEWER_OPEN ?? (process.env.ATM_HUMAN_SELLER_REQUIRED === "1" ? "claim" : "each") },
    "viewer-no-tap": { type: "boolean", default: false },
  },
});
if (!["seller", "judge"].includes(args.role) || !["wassette", "node"].includes(args.runtime)) throw new Error("Use --role seller|judge and --runtime wassette|node");
if (!Number.isInteger(Number(args["poll-ms"])) || Number(args["poll-ms"]) < 100) throw new Error("poll-ms must be an integer >= 100");
if (args["deny-ollama"] && (args.runtime !== "wassette" || args.role !== "seller")) throw new Error("deny-ollama requires the Wassette seller");
if (args["deny-marketplace"] && (args.runtime !== "wassette" || args.role !== "judge")) throw new Error("deny-marketplace requires the Wassette judge");
if ((args.canary || args["canary-only"] || args["measurement-file"]) && args.role !== "seller") throw new Error("seller measurement/canary options require --role seller");
if (args["measurement-file"] && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(args["computer-id"] ?? "")) throw new Error("measurement-file requires a computer-id of 1–64 letters, digits, dots, dashes or underscores");
if (args["register-only"] && args.role !== "seller") throw new Error("register-only requires seller role");
if (args["estimated-watts"] && (!args["measurement-file"] || !Number.isFinite(Number(args["estimated-watts"])) || Number(args["estimated-watts"]) <= 0)) throw new Error("estimated-watts requires a measurement file and positive watts");
if (!["each", "first", "never", "claim"].includes(args["viewer-open"])) throw new Error("viewer-open must be each|first|never|claim");
if (!Number.isInteger(Number(args["viewer-port"])) || Number(args["viewer-port"]) < 0) throw new Error("viewer-port must be a port number (0 picks a free one)");
const role = args.role as "seller" | "judge";
const MARKETPLACE_URL = process.env.MARKETPLACE_URL ?? "http://localhost:3000/mcp";
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const STATE_DIR = process.env.ATM_STATE_DIR ? path.resolve(process.env.ATM_STATE_DIR) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.atm-state");
const suffix = args["display-name"] ? `-${createHash("sha256").update(args["display-name"]).digest("hex").slice(0, 10)}` : "";
const STATE_FILE = args["state-file"] ? path.resolve(args["state-file"]) : path.join(STATE_DIR, `${role}${suffix}.json`);
const pollMs = Number(args["poll-ms"]);
const measurementFile = args["measurement-file"] ? path.resolve(STATE_DIR, "..", args["measurement-file"]) : undefined;
let viewer: LiveView | undefined;
const taps: Tap[] = [];
// With the observer tap on, the sandbox reaches the marketplace and Ollama through 127.0.0.1 forwarders.
let SANDBOX_MARKETPLACE_URL = MARKETPLACE_URL;
let SANDBOX_OLLAMA_URL = OLLAMA_URL;
const log = (...a: unknown[]) => {
  const line = [new Date().toISOString().slice(11, 19), `[${role}]`, ...a];
  console.log(...line);
  viewer?.log(line.map(String).join(" "));
};

interface State { agent_id: string; api_key: string; display_name: string }

function loadState(): State | null {
  if (process.env.AGENT_API_KEY) return { agent_id: "env", api_key: process.env.AGENT_API_KEY, display_name: args["display-name"] ?? role };
  return null;
}

async function ensureAgent(mp: Marketplace): Promise<State> {
  if (process.env.ATM_HUMAN_SELLER_REQUIRED === "1") {
    const saved = readAgentState(STATE_FILE);
    if (!saved) throw new Error("GOOGLE_SIGN_IN_REQUIRED");
    const detail = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    mp.setApiKey(saved.api_key);
    const remote = await mp.call<any>("whoami");
    if (!detail.owner?.user_id || detail.owner.user_id !== remote.owner?.user_id) throw new Error("GOOGLE_SIGN_IN_REQUIRED");
    return saved;
  }
  const existing = loadState();
  if (existing) { mp.setApiKey(existing.api_key); return existing; }
  const display_name = args["display-name"] ?? (role === "seller" ? `seller-${process.env.USER ?? "mac"}` : "atm-judge");
  const state = await registerSavedAgent(STATE_FILE, async () => {
    const res = await mp.call<{ agent_id: string; api_key: string }>("register_agent", {
      kind: role, display_name, ...(role === "judge" ? { judge_secret: process.env.JUDGE_REGISTRATION_SECRET } : {}),
    });
    return { agent_id: res.agent_id, api_key: res.api_key, display_name };
  });
  mp.setApiKey(state.api_key);
  return state;
}

async function makeRuntime(apiKey: string): Promise<Runtime> {
  if (args.runtime === "wassette") {
    const { WassetteRuntime } = await import("./runtime/wassette.js");
    return new WassetteRuntime(role, role === "judge" ? process.env.JUDGE_PRIVATE_KEY_B64 : undefined, {
      apiKey, marketplaceUrl: SANDBOX_MARKETPLACE_URL, ollamaUrl: SANDBOX_OLLAMA_URL, denyOllama: args["deny-ollama"], denyMarketplace: args["deny-marketplace"], observer: viewer,
      stateDir: STATE_DIR,
    });
  }
  const node = new NodeRuntime(role === "judge" ? process.env.JUDGE_PRIVATE_KEY_B64 : undefined, { AGENT_API_KEY: apiKey });
  if (viewer) viewer.vmUpdate(viewer.vmStarted({ role, runtime: "node-unsandboxed", wassette_version: null, wasm_sha256: null, network: [], env: [] }), { state: "ready", pid: process.pid });
  return node;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------------- judge ----
type UsageRow = { purpose: string; attempt: number; model: string; outcome: string; input_tokens: number | null; output_tokens: number | null; cache_creation_input_tokens: number | null; cache_read_input_tokens: number | null; duration_ms: number };
const USAGE_LEDGER = path.join(STATE_DIR, "judge-usage.jsonl");

/** B1: one metadata line per model call (no prompt, answer or key material) for D's cost ledger. */
function recordJudgeUsage(task_id: string, result_id: string, usage: UsageRow[]) {
  if (!usage.length) return;
  const at = new Date().toISOString();
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    fs.appendFileSync(USAGE_LEDGER, usage.map((u) => JSON.stringify({ at, task_id, result_id, ...u })).join("\n") + "\n", { mode: 0o600 });
  } catch (err) { log(`usage ledger write failed: ${safeFailureCode(err)}`); }
}

function usageSummary(usage: UsageRow[]): string {
  if (!usage.length) return "model calls 0";
  const sum = (k: "input_tokens" | "output_tokens") => (usage.some((u) => u[k] === null) ? "unknown" : String(usage.reduce((n, u) => n + (u[k] ?? 0), 0)));
  return `model calls ${usage.length} (${usage.filter((u) => u.outcome !== "ok").length} failed), tokens in ${sum("input_tokens")} out ${sum("output_tokens")}`;
}

async function judgeLoop(rt: Runtime) {
  const info = rt.info();
  log(`judging with runtime=${info.runtime} (${info.description}); each round is one judge-cycle call that fetches, grades and submits inside the runner`);
  for (;;) {
    try {
      const out = await rt.judgeCycle({ marketplace_url: SANDBOX_MARKETPLACE_URL, judge_model: process.env.JUDGE_MODEL });
      if (out.idle) { if (args.once) { log("idle: nothing to review"); return; } await sleep(pollMs); continue; }
      recordJudgeUsage(out.task_id, out.result_id, out.usage);
      if (out.kind === "deferred") {
        const how = out.reported_code
          ? `reported ${out.reported_code}; server review ${out.review?.status ?? "?"} (attempt ${out.review?.attempts ?? "?"}, retry at ${out.review?.retry_at ?? "?"})`
          : "nothing sent (server predates v0.3); task returns to review after the server's JUDGING timeout";
        log(`DEFERRED ${out.task_id} / ${out.result_id}: ${out.failure_code} — judge infrastructure failure, no verdict, seller not penalised; ${how} | ${usageSummary(out.usage)}`);
      } else if (out.kind === "replacement") {
        log(`REPLACEMENT ${out.task_id} / ${out.result_id}: ${out.outcome === "delivered" ? "delivered to the buyer" : `not produced (${out.failure_code}); reported for retry`} | status ${out.replacement_status ?? "?"} | no money or reputation change | ${usageSummary(out.usage)}`);
      } else {
        log(`${out.verdict} ${out.task_id} / ${out.result_id}: ${out.reason_code}${out.score !== undefined ? ` (score ${out.score})` : ""} — ${out.reason_public} | replacement ${out.replacement_status}${out.replacement_failure_code ? ` (${out.replacement_failure_code})` : ""} | payout ${out.seller_payout_cents ?? "?"}c | seller ${out.seller_status ?? "n/a"} | ${usageSummary(out.usage)}`);
      }
      if (args.once) return;
    } catch (err) {
      log(`judge-cycle failed: ${safeFailureCode(err)}`);
      if (args.once) { process.exitCode = 1; return; }
      await sleep(pollMs * 2);
    }
  }
}

// ------------------------------------------------------------------ main ----
const mp = new Marketplace(MARKETPLACE_URL, undefined);
let rt: Runtime | undefined;
let unlock: (() => void) | undefined;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, async () => {
  if (stopping) return;
  stopping = true;
  await rt?.close();
  await mp.close();
  unlock?.();
  await closeViewer();
  process.exit(0);
});
async function startViewer() {
  const { startLiveView } = await import("./viewer/server.js");
  const tap = !args["viewer-no-tap"];
  viewer = await startLiveView({ port: Number(args["viewer-port"]), open: args["viewer-open"] as OpenMode, role, runtime: args.runtime, marketplaceUrl: MARKETPLACE_URL, tap });
  log(`live view: ${viewer.url} (a new window opens for each sandbox instance; --viewer-open each|first|never)`);
  if (!tap) return;
  const { startTap } = await import("./viewer/tap.js");
  const marketplaceTap = await startTap(viewer, "marketplace", MARKETPLACE_URL);
  taps.push(marketplaceTap);
  SANDBOX_MARKETPLACE_URL = marketplaceTap.url;
  // The denied-Ollama demo needs the real Ollama hostname so the policy still blocks it.
  if (!args["deny-ollama"]) {
    const ollamaTap = await startTap(viewer, "ollama", OLLAMA_URL);
    taps.push(ollamaTap);
    SANDBOX_OLLAMA_URL = ollamaTap.url;
  }
  log("observer tap ON: the sandbox reaches the marketplace and Ollama via 127.0.0.1 forwarders so the live view can show the prompt and stream model output. Demo aid; it exposes decrypted task content on this machine.");
}

async function closeViewer() {
  for (const tap of taps.splice(0)) await tap.close().catch(() => {});
  await viewer?.close().catch(() => {});
  viewer = undefined;
}

try {
  if (args.viewer && !args["canary-only"] && !args["register-only"]) await startViewer();
  log(`marketplace ${MARKETPLACE_URL}`);
  if (args["canary-only"]) {
    rt = await makeRuntime("local-canary-no-marketplace-identity");
    const recorder = measurementFile ? new MeasurementRecorder({ file: measurementFile, computerId: args["computer-id"]!, sellerId: null,
      estimatedWatts: args["estimated-watts"] ? Number(args["estimated-watts"]) : undefined, runtime: () => rt!.info(), warn: log }) : undefined;
    const models = await listOllamaModels(OLLAMA_URL);
    const selected = args.model?.length ? args.model : ["qwen3:8b"];
    for (const model of selected) {
      const finish = recorder?.begin({ kind: "model_canary", model_id: model, model_digest: models.find((m) => m.model_id === model)?.digest });
      try {
        if (!rt.modelCanary) throw new Error("CANARY_UNSUPPORTED");
        const out = await rt.modelCanary({ ollama_url: SANDBOX_OLLAMA_URL, model_id: model });
        finish?.({ status: out.passed ? "passed" : "failed", ...out, error_code: out.passed ? undefined : "CANARY_MISMATCH" });
        log(`canary model=${model} passed=${out.passed} runtime=${rt.info().runtime} elapsed=${out.runtime_ms}ms; no marketplace task; not attestation`);
        if (!out.passed) process.exitCode = 1;
      } catch (error) { finish?.({ status: "failed", error_code: safeFailureCode(error) }); throw error; }
    }
  } else {
    if (!process.env.AGENT_API_KEY) unlock = lockIdentity(STATE_FILE);
    if (role === "seller") {
      if (process.env.ATM_REQUIRE_RELEASE === "1") await requireCompatibleRelease(MARKETPLACE_URL);
      if (args["ask-cents"] !== undefined) log("--ask-cents is obsolete and ignored. Claiming accepts the task's posted price.");
      try { requireTaskPricing(await mp.call("marketplace_info")); }
      catch (error) { log("Seller startup requires a server advertising pricing.mode=task_offer. Update the server before starting this seller."); throw error; }
    }
    const state = await ensureAgent(mp);
    log(`agent ${state.agent_id} (${state.display_name})`);
    rt = await makeRuntime(state.api_key);
    if (process.env.ATM_HUMAN_SELLER_REQUIRED === "1" && !args["register-only"]) {
      const preparedFile = process.env.ATM_PREPARED_FILE;
      if (!preparedFile || !fs.existsSync(preparedFile)) throw new Error("MODEL_SETUP_REQUIRED");
      const prepared = JSON.parse(fs.readFileSync(preparedFile, "utf8"));
      if (prepared.seller_id !== state.agent_id || prepared.runner_sha256 !== rt.info().wasm_sha256) throw new Error("MODEL_SETUP_REQUIRED");
    }
    if (role === "seller") await sellerLoop(mp, rt, {
      marketplaceUrl: SANDBOX_MARKETPLACE_URL, ollamaUrl: SANDBOX_OLLAMA_URL, pollMs,
      compute: process.env.ATM_STATUS_FILE ? readCompute(path.join(path.dirname(process.env.ATM_STATUS_FILE), "compute.json")) : undefined,
      models: args.model, once: args.once, taskId: args["task-id"], log, canary: args.canary,
      registerOnly: args["register-only"],
      beforeClaim: process.env.ATM_REQUIRE_RELEASE === "1" ? async () => {
        await requireCompatibleRelease(MARKETPLACE_URL);
        if (process.env.ATM_HUMAN_SELLER_REQUIRED === "1" && (await mp.call<any>("whoami")).payout?.payout_status !== "ACTIVE") throw new Error("PAYOUT_ONBOARDING_REQUIRED");
      } : undefined,
      onRegistered: async (models) => {
        if (!process.env.ATM_STATUS_FILE) return;
        let payout: Record<string, unknown> = { payout_status: "UNAVAILABLE", payout_onboarding_url: null };
        try { payout = args["register-only"] ? await mp.call("get_seller_onboarding") : ((await mp.call<any>("whoami")).payout ?? payout); }
        catch { log("Payout status unavailable; existing identity is retained. Use atm-seller status to check again."); }
        const status = { viewer_url: viewer?.url ?? null, worker_pid: process.pid, registration_only: Boolean(args["register-only"]), seller_id: state.agent_id, display_name: state.display_name, models, ...rt!.info(), ...payout, updated_at: new Date().toISOString() };
        fs.writeFileSync(process.env.ATM_STATUS_FILE, JSON.stringify(status, null, 2), { mode: 0o600 });
        log(`payout status=${payout.payout_status}; ${payout.payout_label ?? "Stripe TEST mode"}`);

      },
      onPayoutPoll: process.env.ATM_STATUS_FILE ? async () => {
        const file = process.env.ATM_STATUS_FILE!;
        const current = JSON.parse(fs.readFileSync(file, "utf8"));
        if (["ACTIVE", "MOCK"].includes(current.payout_status)) return true;
        const payout = (await mp.call<any>("whoami")).payout;
        if (payout) {
          fs.writeFileSync(file, JSON.stringify({ ...current, ...payout, updated_at: new Date().toISOString() }, null, 2), { mode: 0o600 });
          if (payout.payout_status === "ACTIVE") log("Stripe TEST transfer capability is active.");
        }
        return payout?.payout_status === "ACTIVE";
      } : undefined,
      measurements: measurementFile ? new MeasurementRecorder({ file: measurementFile, computerId: args["computer-id"]!, sellerId: state.agent_id === "env" ? null : state.agent_id,
        estimatedWatts: args["estimated-watts"] ? Number(args["estimated-watts"]) : undefined, runtime: () => rt!.info(), warn: log }) : undefined,
    });
    else await judgeLoop(rt);
  }
} catch (error) {
  log(`stopped: ${safeFailureCode(error)}`);
  process.exitCode = 1;
} finally {
  await rt?.close();
  await mp.close();
  unlock?.();
  if (viewer && !stopping) { log(`run finished; live view stays at ${viewer.url}. Press Ctrl-C to exit.`); await new Promise(() => {}); }
  await closeViewer();
}
