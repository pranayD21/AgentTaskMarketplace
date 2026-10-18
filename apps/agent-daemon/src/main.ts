import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { sellerLoop } from "./seller.js";
import { safeFailureCode } from "@atm/runner-core";
import { parseArgs } from "node:util";
import { MarketplaceError, isAllowlistedModel, type ClaimPublic, type Envelope, type KeyDescriptor } from "@atm/shared";
import { Marketplace } from "./marketplace.js";
import { listOllamaModels } from "./ollama.js";
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
    "ask-cents": { type: "string", default: "75" },
    "display-name": { type: "string" },
    "poll-ms": { type: "string", default: "5000" },
    "state-file": { type: "string" },
    "task-id": { type: "string" },
    "deny-ollama": { type: "boolean", default: false },
    once: { type: "boolean", default: false },
  },
});
if (!["seller", "judge"].includes(args.role) || !["wassette", "node"].includes(args.runtime)) throw new Error("Use --role seller|judge and --runtime wassette|node");
if (!Number.isInteger(Number(args["poll-ms"])) || Number(args["poll-ms"]) < 100) throw new Error("poll-ms must be an integer >= 100");
if (!Number.isInteger(Number(args["ask-cents"])) || Number(args["ask-cents"]) < 0) throw new Error("ask-cents must be a nonnegative integer");
if (args["deny-ollama"] && (args.runtime !== "wassette" || args.role !== "seller")) throw new Error("deny-ollama requires the Wassette seller");
const role = args.role as "seller" | "judge";
const MARKETPLACE_URL = process.env.MARKETPLACE_URL ?? "http://localhost:3000/mcp";
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const STATE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.atm-state");
const suffix = args["display-name"] ? `-${createHash("sha256").update(args["display-name"]).digest("hex").slice(0, 10)}` : "";
const STATE_FILE = args["state-file"] ? path.resolve(args["state-file"]) : path.join(STATE_DIR, `${role}${suffix}.json`);
const pollMs = Number(args["poll-ms"]);
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
      apiKey, marketplaceUrl: MARKETPLACE_URL, ollamaUrl: OLLAMA_URL, denyOllama: args["deny-ollama"],
    });
  }
  return new NodeRuntime(role === "judge" ? process.env.JUDGE_PRIVATE_KEY_B64 : undefined);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------------- judge ----
async function judgeLoop(mp: Marketplace, rt: Runtime) {
  log(`judging with runtime=${rt.info().runtime} (${rt.info().description})`);
  for (;;) {
    try {
      const { package: pkg } = await mp.call<{ package: null | { task_id: string; result_id: string; payload_enc_judge: Envelope; result_enc_judge: Envelope; commitment_sha256: string; buyer_public_key: KeyDescriptor; model_id: string } }>("fetch_review_package");
      if (!pkg) { if (args.once) return; await sleep(pollMs); continue; }
      log(`reviewing ${pkg.task_id} / ${pkg.result_id} (model ${pkg.model_id})`);
      const verdict = await rt.judgeTask(pkg.payload_enc_judge, pkg.result_enc_judge, { buyer_public_key: pkg.buyer_public_key, judge_model: process.env.JUDGE_MODEL });
      const res = await mp.call<{ task: { status: string }; settlement: { seller_payout_cents: number; note: string | null }; seller_status: string | null }>("submit_verdict", {
        task_id: pkg.task_id, result_id: pkg.result_id, verdict: verdict.verdict, reason_code: verdict.reason_code, reason_public: verdict.reason_public,
        score: verdict.score, replacement_enc_buyer: verdict.replacement_enc_buyer,
      });
      log(`${verdict.verdict} ${pkg.task_id}: ${verdict.reason_code} — ${verdict.reason_public} | payout ${res.settlement?.seller_payout_cents}c | seller ${res.seller_status ?? "n/a"} | ${res.settlement?.note ?? ""}`);
      if (args.once) return;
    } catch (err) {
      log("loop error:", (err as Error).message);
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
  const state = await ensureAgent(mp);
  log(`agent ${state.agent_id} (${state.display_name})`);
  rt = await makeRuntime(state.api_key);
  if (role === "seller") await sellerLoop(mp, rt, {
    marketplaceUrl: MARKETPLACE_URL, ollamaUrl: OLLAMA_URL, pollMs, askCents: Number(args["ask-cents"]),
    models: args.model, once: args.once, taskId: args["task-id"], log,
  });
  else await judgeLoop(mp, rt);
} catch (error) {
  log(`stopped: ${safeFailureCode(error)}`);
  process.exitCode = 1;
} finally { await rt?.close(); await mp.close(); }
