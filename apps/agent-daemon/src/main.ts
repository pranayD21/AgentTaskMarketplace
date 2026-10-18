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
import type { Runtime } from "./runtime/types.js";

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
    "deny-ollama": { type: "boolean", default: false },
    "deny-marketplace": { type: "boolean", default: false },
    once: { type: "boolean", default: false },
  },
});
if (!["seller", "judge"].includes(args.role) || !["wassette", "node"].includes(args.runtime)) throw new Error("Use --role seller|judge and --runtime wassette|node");
if (!Number.isInteger(Number(args["poll-ms"])) || Number(args["poll-ms"]) < 100) throw new Error("poll-ms must be an integer >= 100");
if (args["deny-ollama"] && (args.runtime !== "wassette" || args.role !== "seller")) throw new Error("deny-ollama requires the Wassette seller");
if (args["deny-marketplace"] && (args.runtime !== "wassette" || args.role !== "judge")) throw new Error("deny-marketplace requires the Wassette judge");
if ((args.canary || args["canary-only"] || args["measurement-file"]) && args.role !== "seller") throw new Error("seller measurement/canary options require --role seller");
if (args["measurement-file"] && !/^[ABCDE]$/.test(args["computer-id"] ?? "")) throw new Error("measurement-file requires --computer-id A|B|C|D|E");
if (args["estimated-watts"] && (!args["measurement-file"] || !Number.isFinite(Number(args["estimated-watts"])) || Number(args["estimated-watts"]) <= 0)) throw new Error("estimated-watts requires a measurement file and positive watts");
const role = args.role as "seller" | "judge";
const MARKETPLACE_URL = process.env.MARKETPLACE_URL ?? "http://localhost:3000/mcp";
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const STATE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.atm-state");
const suffix = args["display-name"] ? `-${createHash("sha256").update(args["display-name"]).digest("hex").slice(0, 10)}` : "";
const STATE_FILE = args["state-file"] ? path.resolve(args["state-file"]) : path.join(STATE_DIR, `${role}${suffix}.json`);
const pollMs = Number(args["poll-ms"]);
const measurementFile = args["measurement-file"] ? path.resolve(STATE_DIR, "..", args["measurement-file"]) : undefined;
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), `[${role}]`, ...a);

interface State { agent_id: string; api_key: string; display_name: string }

function loadState(): State | null {
  if (process.env.AGENT_API_KEY) return { agent_id: "env", api_key: process.env.AGENT_API_KEY, display_name: args["display-name"] ?? role };
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as State; } catch { return null; }
}

async function ensureAgent(mp: Marketplace): Promise<State> {
  const existing = loadState();
  if (existing) { mp.setApiKey(existing.api_key); return existing; }
  const display_name = args["display-name"] ?? (role === "seller" ? `seller-${process.env.USER ?? "mac"}` : "atm-judge");
  const res = await mp.call<{ agent_id: string; api_key: string }>("register_agent", {
    kind: role, display_name, ...(role === "judge" ? { judge_secret: process.env.JUDGE_REGISTRATION_SECRET } : {}),
  });
  const state: State = { agent_id: res.agent_id, api_key: res.api_key, display_name };
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  mp.setApiKey(state.api_key);
  log(`registered as ${state.agent_id}; key saved to ${STATE_FILE}`);
  return state;
}

async function makeRuntime(apiKey: string): Promise<Runtime> {
  if (args.runtime === "wassette") {
    const { WassetteRuntime } = await import("./runtime/wassette.js");
    return new WassetteRuntime(role, role === "judge" ? process.env.JUDGE_PRIVATE_KEY_B64 : undefined, {
      apiKey, marketplaceUrl: MARKETPLACE_URL, ollamaUrl: OLLAMA_URL, denyOllama: args["deny-ollama"], denyMarketplace: args["deny-marketplace"],
    });
  }
  return new NodeRuntime(role === "judge" ? process.env.JUDGE_PRIVATE_KEY_B64 : undefined, { AGENT_API_KEY: apiKey });
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
      const out = await rt.judgeCycle({ marketplace_url: MARKETPLACE_URL, judge_model: process.env.JUDGE_MODEL });
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
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, async () => {
  if (stopping) return;
  stopping = true;
  await rt?.close();
  await mp.close();
  process.exit(0);
});
try {
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
        const out = await rt.modelCanary({ ollama_url: OLLAMA_URL, model_id: model });
        finish?.({ status: out.passed ? "passed" : "failed", ...out, error_code: out.passed ? undefined : "CANARY_MISMATCH" });
        log(`canary model=${model} passed=${out.passed} runtime=${rt.info().runtime} elapsed=${out.runtime_ms}ms; no marketplace task; not attestation`);
        if (!out.passed) process.exitCode = 1;
      } catch (error) { finish?.({ status: "failed", error_code: safeFailureCode(error) }); throw error; }
    }
  } else {
    if (role === "seller") {
      if (args["ask-cents"] !== undefined) log("--ask-cents is obsolete and ignored. Claiming accepts the task's posted price.");
      try { requireTaskPricing(await mp.call("marketplace_info")); }
      catch (error) { log("Seller startup requires a server advertising pricing.mode=task_offer. Update the server before starting this seller."); throw error; }
    }
    const state = await ensureAgent(mp);
    log(`agent ${state.agent_id} (${state.display_name})`);
    rt = await makeRuntime(state.api_key);
    if (role === "seller") await sellerLoop(mp, rt, {
      marketplaceUrl: MARKETPLACE_URL, ollamaUrl: OLLAMA_URL, pollMs,
      models: args.model, once: args.once, taskId: args["task-id"], log, canary: args.canary,
      measurements: measurementFile ? new MeasurementRecorder({ file: measurementFile, computerId: args["computer-id"]!, sellerId: state.agent_id === "env" ? null : state.agent_id,
        estimatedWatts: args["estimated-watts"] ? Number(args["estimated-watts"]) : undefined, runtime: () => rt!.info(), warn: log }) : undefined,
    });
    else await judgeLoop(rt);
  }
} catch (error) {
  log(`stopped: ${safeFailureCode(error)}`);
  process.exitCode = 1;
} finally { await rt?.close(); await mp.close(); }
