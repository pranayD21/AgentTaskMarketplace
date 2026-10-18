import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { MarketplaceError, isAllowlistedModel, type ClaimPublic, type Envelope, type KeyDescriptor } from "@atm/shared";
import { Marketplace } from "./marketplace.js";
import { listOllamaModels } from "./ollama.js";
import { NodeRuntime } from "./runtime/node.js";
import type { Runtime } from "./runtime/types.js";

const { values: args } = parseArgs({
  // pnpm 10 forwards the literal `--` from `pnpm daemon -- …`; drop it.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    role: { type: "string", default: "seller" },
    runtime: { type: "string", default: process.env.ATM_RUNTIME ?? "wassette" },
    model: { type: "string", multiple: true },
    "ask-cents": { type: "string", default: "75" },
    "display-name": { type: "string" },
    "poll-ms": { type: "string", default: "3000" },
    once: { type: "boolean", default: false },
  },
});
const role = args.role as "seller" | "judge";
const MARKETPLACE_URL = process.env.MARKETPLACE_URL ?? "http://localhost:3000/mcp";
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const STATE_DIR = path.resolve(process.cwd(), "../../.atm-state");
const STATE_FILE = path.join(STATE_DIR, `${role}.json`);
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
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  mp.setApiKey(state.api_key);
  log(`registered as ${state.agent_id}; key saved to ${STATE_FILE}`);
  return state;
}

async function makeRuntime(agentApiKey: string): Promise<Runtime> {
  if (args.runtime === "wassette") {
    const { WassetteRuntime } = await import("./runtime/wassette.js").catch(() => ({ WassetteRuntime: null }));
    if (WassetteRuntime) return new WassetteRuntime(role, { judgePrivateKeyB64: process.env.JUDGE_PRIVATE_KEY_B64, agentApiKey, marketplaceUrl: MARKETPLACE_URL });
    log("WARNING: wassette runtime not available yet; falling back to node-unsandboxed");
  }
  return new NodeRuntime(process.env.JUDGE_PRIVATE_KEY_B64, { AGENT_API_KEY: agentApiKey });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- seller ----
async function sellerLoop(mp: Marketplace, rt: Runtime) {
  const info = await mp.call<{ models: { model_id: string }[] }>("marketplace_info");
  const ollama = await listOllamaModels(OLLAMA_URL);
  const wanted = args.model?.length ? new Set(args.model) : null;
  const models = ollama
    .filter((m) => isAllowlistedModel(m.model_id) && (!wanted || wanted.has(m.model_id)))
    .map((m) => ({ model_id: m.model_id, digest: m.digest, ask_cents: Number(args["ask-cents"]) }));
  if (!models.length) throw new Error(`no allowlisted Ollama models found locally (have: ${ollama.map((m) => m.model_id).join(", ") || "none"}; allowlist: ${info.models.map((m) => m.model_id).join(", ")})`);
  const pub = await rt.getPublicKey();
  const rinfo = rt.info();
  const reg = await mp.call<{ seller: { seller_id: string; status: string } }>("register_seller", {
    models, runner_pubkey_b64: pub.public_key_b64, runner_key_id: pub.key_id,
    runner_wasm_sha256: rinfo.wasm_sha256 ?? undefined, runtime: rinfo.runtime, wassette_version: rinfo.wassette_version ?? undefined,
  });
  log(`listed ${models.map((m) => `${m.model_id}@${m.ask_cents}c`).join(", ")} | runtime=${rinfo.runtime} (${rinfo.description}) | key=${pub.key_id} | status=${reg.seller.status}`);

  for (;;) {
    try {
      const { tasks } = await mp.call<{ tasks: { task_id: string; eligible_models: string[]; max_price_cents: number }[] }>("list_open_tasks");
      const t = tasks[0];
      if (!t) { if (args.once) return; await sleep(pollMs); continue; }
      const modelId = t.eligible_models[0]!;
      let claim: ClaimPublic;
      try {
        ({ claim } = await mp.call<{ claim: ClaimPublic }>("claim_task", { task_id: t.task_id, model_id: modelId }));
      } catch (err) {
        if (err instanceof MarketplaceError && (err.code === "CLAIM_CONFLICT" || err.code === "SELLER_SUSPENDED")) { log(`claim ${t.task_id}: ${err.code} ${err.message}`); if (err.code === "SELLER_SUSPENDED") return; await sleep(pollMs); continue; }
        throw err;
      }
      log(`claimed ${t.task_id} (${claim.claim_id}) model=${modelId} price=${claim.price_cents}c lease=${claim.lease_expires_at}`);
      await runClaim(mp, rt, claim);
      if (args.once) return;
    } catch (err) {
      log("loop error:", (err as Error).message);
      await sleep(pollMs * 2);
    }
  }
}

async function runClaim(mp: Marketplace, rt: Runtime, claim: ClaimPublic) {
  await mp.call("start_task", { task_id: claim.task_id, claim_id: claim.claim_id });
  const keys = await mp.call<{ buyer_public_key: KeyDescriptor; judge_public_key: KeyDescriptor }>("get_recipient_keys", { task_id: claim.task_id, claim_id: claim.claim_id });
  const renew = setInterval(() => mp.call("renew_lease", { task_id: claim.task_id, claim_id: claim.claim_id }).catch((e) => log("renew failed:", (e as Error).message)), 120_000);
  try {
    const out = await rt.runTask(claim.seller_envelope as Envelope, {
      ollama_url: OLLAMA_URL, model_id: claim.model_id, buyer_public_key: keys.buyer_public_key, judge_public_key: keys.judge_public_key,
      timeout_ms: claim.max_runtime_s * 1000,
    });
    const res = await mp.call<{ result_id: string }>("submit_result", {
      task_id: claim.task_id, claim_id: claim.claim_id, result_enc_buyer: out.result_enc_buyer, result_enc_judge: out.result_enc_judge,
      commitment_sha256: out.commitment_sha256, runtime_ms: out.runtime_ms, tokens_out: out.tokens_out,
    });
    log(`submitted ${res.result_id} for ${claim.task_id} in ${out.runtime_ms}ms (${out.tokens_out ?? "?"} tokens); commitment ${out.commitment_sha256.slice(0, 12)}…`);
  } catch (err) {
    log(`run failed for ${claim.task_id}: ${(err as Error).message}; releasing`);
    await mp.call("release_task", { task_id: claim.task_id, claim_id: claim.claim_id, reason: (err as Error).message.slice(0, 180) }).catch(() => {});
  } finally {
    clearInterval(renew);
  }
}

// ----------------------------------------------------------------- judge ----
async function judgeLoop(rt: Runtime) {
  const info = rt.info();
  log(`judging with runtime=${info.runtime} (${info.description}); each round is one judge-cycle call: the runner fetches, grades and submits itself`);
  for (;;) {
    try {
      const out = await rt.judgeCycle({ marketplace_url: MARKETPLACE_URL, judge_model: process.env.JUDGE_MODEL });
      if (out.idle) { if (args.once) { log("idle: nothing to review"); return; } await sleep(pollMs); continue; }
      log(`${out.verdict} ${out.task_id} / ${out.result_id}: ${out.reason_code}${out.score !== undefined ? ` (score ${out.score})` : ""} — ${out.reason_public} | payout ${out.seller_payout_cents ?? "?"}c | seller ${out.seller_status ?? "n/a"} | ${out.settlement_note ?? ""}`);
      if (args.once) return;
    } catch (err) {
      log("loop error:", (err as Error).message);
      if (args.once) return;
      await sleep(pollMs * 2);
    }
  }
}

// ------------------------------------------------------------------ main ----
const mp = new Marketplace(MARKETPLACE_URL, undefined);
log(`marketplace ${MARKETPLACE_URL}`);
const state = await ensureAgent(mp);
log(`agent ${state.agent_id} (${state.display_name})`);
const rt = await makeRuntime(state.api_key);
process.on("SIGINT", async () => { await rt.close(); process.exit(0); });
if (role === "seller") await sellerLoop(mp, rt); else await judgeLoop(rt);
await rt.close();
