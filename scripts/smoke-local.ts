#!/usr/bin/env -S npx tsx
/**
 * Offline end-to-end smoke test of the real MCP server, the real seller and
 * judge daemons (node runtime) and contract v0.2 per-claim keys, without
 * Insforge, Stripe, Inkbox, Ollama or Anthropic:
 *
 *   pnpm smoke            # or: npx tsx scripts/smoke-local.ts
 *
 * The server runs with DB_MODE=memory and PAYMENT_MODE=mock (both labelled in
 * /health), with a throwaway KEK and judge keypair generated here. Ollama is
 * replaced by FAKE_OLLAMA below, a test double that answers every prompt with
 * a fixed string. Nothing here proves model quality, sandboxing or payments;
 * it proves the tools, state machine, envelopes and daemons fit together.
 */
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { generateKeypair, keyIdFor, openJson, toB64 } from "@atm/crypto";
import { createRunner, type RunnerHost } from "@atm/runner-core";
import type { ClaimPublicV02, SellerPayload } from "@atm/shared";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = Number(process.env.SMOKE_PORT ?? 3917);
const OLLAMA_PORT = Number(process.env.SMOKE_OLLAMA_PORT ?? 11939);
const MCP = `http://127.0.0.1:${PORT}/mcp`;
const ANSWER = "Lima";

const children: ChildProcess[] = [];
const step = (msg: string) => console.log(`\n▶ ${msg}`);
const fail = (msg: string): never => { throw new Error(msg); };

// --------------------------------------------------------------- fake Ollama
const FAKE_OLLAMA = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "qwen3:8b", digest: "fake-ollama-test-double", size: 0 }] }));
  if (req.url === "/api/chat") return res.end(JSON.stringify({ message: { role: "assistant", content: ANSWER }, eval_count: 1 }));
  res.statusCode = 404;
  res.end("{}");
});

// ---------------------------------------------------------------- MCP client
class Client {
  private sid: string | null = null;
  constructor(private key?: string) {}
  private async rpc(method: string, params: unknown): Promise<any> {
    const res = await fetch(MCP, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(this.sid ? { "mcp-session-id": this.sid } : {}), ...(this.key ? { authorization: `Bearer ${this.key}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    this.sid = res.headers.get("mcp-session-id") ?? this.sid;
    const text = await res.text();
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    const json = JSON.parse(line ? line.slice(5) : text);
    if (json.error) fail(`${method}: ${JSON.stringify(json.error)}`);
    return json.result;
  }
  async init() {
    await this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "atm-smoke", version: "0.1" } });
    return this;
  }
  /** Returns the tool's JSON; for tool errors returns `{ error }` instead of throwing. */
  async tool(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const r = await this.rpc("tools/call", { name, arguments: args });
    return JSON.parse(r.content?.[0]?.text ?? "{}");
  }
  async ok(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const out = await this.tool(name, args);
    if (out.error) fail(`${name}: ${JSON.stringify(out.error)}`);
    return out;
  }
}

// Own process group per child so cleanup also stops what npx/pnpm spawn.
function run(cmd: string, args: string[], env: Record<string, string>, cwd = ROOT): ChildProcess {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  children.push(child);
  return child;
}

function stop(child: ChildProcess): void {
  try { if (child.pid && child.exitCode === null) process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
}

function waitExit(child: ChildProcess, label: string, timeoutMs = 60_000): Promise<string> {
  let out = "";
  child.stdout!.on("data", (d) => (out += d));
  child.stderr!.on("data", (d) => (out += d));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(child); reject(new Error(`${label} timed out:\n${out}`)); }, timeoutMs);
    child.on("exit", (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`${label} exited ${code}:\n${out}`)); });
  });
}

async function main() {
  const kek = toB64(crypto.getRandomValues(new Uint8Array(32)));
  const judge = generateKeypair();
  const judgeKeyId = `judge-${keyIdFor(judge.publicKey)}`;
  const judgeSecret = toB64(crypto.getRandomValues(new Uint8Array(18)));
  await new Promise<void>((r) => FAKE_OLLAMA.listen(OLLAMA_PORT, "127.0.0.1", r));

  step(`server on :${PORT} (DB_MODE=memory, PAYMENT_MODE=mock)`);
  const server = run("npx", ["mcp-use", "dev", "--port", String(PORT), "--no-open", "--no-inspector"], {
    DB_MODE: "memory", PAYMENT_MODE: "mock", INKBOX_API_KEY: "", SERVER_KEK_B64: kek,
    JUDGE_PUBLIC_KEY_B64: toB64(judge.publicKey), JUDGE_KEY_ID: judgeKeyId, JUDGE_REGISTRATION_SECRET: judgeSecret,
    BASE_URL: `http://127.0.0.1:${PORT}`, PORT: String(PORT),
  }, path.join(ROOT, "apps/marketplace-mcp"));
  let serverLog = "";
  server.stdout!.on("data", (d) => (serverLog += d));
  server.stderr!.on("data", (d) => (serverLog += d));
  let health: any;
  for (let i = 0; i < 60 && !health; i++) {
    health = await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.json()).catch(() => null);
    if (!health) await new Promise((r) => setTimeout(r, 500));
  }
  if (!health) fail(`server did not start:\n${serverLog}`);
  console.log(`  health: contract=${health.contract} payments=${health.payments} db=${health.db}`);

  const pub = await new Client().init();
  const info = await pub.ok("marketplace_info");
  console.log(`  marketplace_info: contract ${info.contract_version}, ${info.models.length} models, storage: ${info.storage}`);
  const reg = async (kind: string, extra: Record<string, unknown> = {}) => pub.ok("register_agent", { kind, display_name: `smoke-${kind}`, ...extra });
  const buyerReg = await reg("buyer", { spend_cap_cents: 1000 });
  const sellerReg = await reg("seller");
  const judgeReg = await reg("judge", { judge_secret: judgeSecret });
  const buyer = await new Client(buyerReg.api_key).init();
  const post = async () => (await buyer.ok("post_task", { prompt: "What is the capital of Peru? One word.", allowed_models: ["qwen3:8b"], max_price_cents: 100, rubric: { kind: "contains_text", expected_text: ANSWER } })).task.task_id as string;

  // ---- 1. v0.1 path through the real daemons (registered key) -------------
  step("v0.1 path: seller + judge daemons (--runtime node, labelled UNSANDBOXED)");
  const t1 = await post();
  console.log(`  posted ${t1}`);
  const daemonEnv = { MARKETPLACE_URL: MCP, OLLAMA_URL: `http://127.0.0.1:${OLLAMA_PORT}` };
  const sellerOut = await waitExit(run("pnpm", ["daemon", "--role", "seller", "--runtime", "node", "--once", "--ask-cents", "75"], { ...daemonEnv, AGENT_API_KEY: sellerReg.api_key, JUDGE_PRIVATE_KEY_B64: "" }), "seller daemon");
  console.log(sellerOut.split("\n").filter((l) => /\[seller\] (listed|claimed|submitted)/.test(l)).map((l) => `  ${l}`).join("\n"));
  const judgeOut = await waitExit(run("pnpm", ["daemon", "--role", "judge", "--runtime", "node", "--once"], { ...daemonEnv, AGENT_API_KEY: judgeReg.api_key, JUDGE_PRIVATE_KEY_B64: toB64(judge.secretKey) }), "judge daemon");
  console.log(judgeOut.split("\n").filter((l) => /\[judge\] (APPROVE|REJECT)/.test(l)).map((l) => `  ${l}`).join("\n"));
  const r1 = await buyer.ok("get_result", { task_id: t1 });
  if (r1.task.status !== "APPROVED" || r1.result?.commitment_verified !== true || r1.result?.answer !== ANSWER) fail(`unexpected result for ${t1}: ${JSON.stringify({ status: r1.task.status, result: r1.result })}`);
  console.log(`  get_result: ${r1.task.status}, commitment_verified=${r1.result.commitment_verified}, settlement ${r1.settlement.kind} payout ${r1.settlement.seller_payout_cents}c refund ${r1.settlement.buyer_refund_cents}c`);

  // ---- 2. v0.2 per-claim key through the tool layer ------------------------
  step("v0.2 path: seller registered without a key, per-claim key on claim_task");
  const s2Reg = await reg("seller");
  const s2 = await new Client(s2Reg.api_key).init();
  const listed = await s2.ok("register_seller", { models: [{ model_id: "qwen3:8b", ask_cents: 60 }], runtime: "wassette" });
  console.log(`  register_seller without key → runner.key_source=${listed.seller.runner.key_source}`);
  const t2 = await post();
  const noKey = await s2.tool("claim_task", { task_id: t2, model_id: "qwen3:8b" });
  if (noKey.error?.code !== "INVALID_STATE" || !noKey.error.next_action) fail(`claim without key should be INVALID_STATE with next_action: ${JSON.stringify(noKey)}`);
  console.log(`  claim_task without key → ${noKey.error.code} (next_action present)`);
  const badKey = await s2.tool("claim_task", { task_id: t2, model_id: "qwen3:8b", runner_pubkey_b64: toB64(new Uint8Array(31)) });
  if (badKey.error?.code !== "VALIDATION_ERROR") fail(`bad key should be VALIDATION_ERROR: ${JSON.stringify(badKey)}`);
  console.log(`  claim_task with a 31-byte key → ${badKey.error.code}`);

  const host: RunnerHost = { fetch, getSecret: async () => undefined, now: () => Date.now() };
  const runner = createRunner(host);
  const key = runner.getPublicKey();
  const { claim } = (await s2.ok("claim_task", { task_id: t2, model_id: "qwen3:8b", runner_pubkey_b64: key.public_key_b64, runner_key_id: key.key_id })) as { claim: ClaimPublicV02 };
  if (claim.runner_key_source !== "per-claim" || claim.seller_envelope.recipient_key_id !== key.key_id) fail(`claim not sealed to the per-claim key: ${JSON.stringify({ src: claim.runner_key_source, rk: claim.seller_envelope.recipient_key_id })}`);
  if (!claim.buyer_public_key?.key_id || claim.judge_public_key?.key_id !== judgeKeyId) fail("claim response is missing buyer/judge keys");
  console.log(`  claim_task with key ${key.key_id} → ${claim.claim_id}, sealed to it, buyer=${claim.buyer_public_key.key_id} judge=${claim.judge_public_key.key_id}`);
  const out = await runner.runTask(claim.seller_envelope, { ollama_url: `http://127.0.0.1:${OLLAMA_PORT}`, model_id: claim.model_id, buyer_public_key: claim.buyer_public_key, judge_public_key: claim.judge_public_key });
  await s2.ok("submit_result", { task_id: t2, claim_id: claim.claim_id, ...out });
  let opensWithOtherKey = true;
  try { openJson<SellerPayload>(generateKeypair(), claim.seller_envelope); } catch { opensWithOtherKey = false; }
  if (opensWithOtherKey) fail("a different key decrypted the seller envelope");
  const judgeOut2 = await waitExit(run("pnpm", ["daemon", "--role", "judge", "--runtime", "node", "--once"], { ...daemonEnv, AGENT_API_KEY: judgeReg.api_key, JUDGE_PRIVATE_KEY_B64: toB64(judge.secretKey) }), "judge daemon");
  console.log(judgeOut2.split("\n").filter((l) => /\[judge\] (APPROVE|REJECT)/.test(l)).map((l) => `  ${l}`).join("\n"));
  const r2 = await buyer.ok("get_result", { task_id: t2 });
  if (r2.task.status !== "APPROVED" || r2.result?.commitment_verified !== true) fail(`unexpected result for ${t2}: ${JSON.stringify({ status: r2.task.status })}`);
  const rep = await pub.ok("get_seller_reputation", { seller_id: s2Reg.agent_id });
  console.log(`  get_result: ${r2.task.status}, commitment_verified=${r2.result.commitment_verified}; seller runner key ${rep.runner.public_key.key_id} (${rep.runner.key_source})`);

  const whoami = await buyer.ok("whoami");
  console.log(`\n✔ smoke passed — buyer spend: reserved ${whoami.spend.reserved_cents}c, spent ${whoami.spend.spent_cents}c of ${whoami.spend.cap_cents}c (MOCK)`);
}

main()
  .catch((err) => { console.error(`\n✘ smoke failed: ${(err as Error).message}`); process.exitCode = 1; })
  .finally(() => { for (const c of children) stop(c); FAKE_OLLAMA.close(); });
