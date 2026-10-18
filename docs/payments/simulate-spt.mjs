#!/usr/bin/env node
// Exercise PAYMENT_MODE=mpp end to end WITHOUT a phone or a Link wallet:
//   1. post a task  → AWAITING_PAYMENT + payment_link
//   2. POST the payment_link with no credential → HTTP 402 + WWW-Authenticate: Payment …
//   3. mint a granted Shared Payment Token with Stripe's TEST helper (pm_card_visa)
//   4. pay the challenge with the mppx client (Authorization: Payment …) → 200 + Payment-Receipt
//   5. read the task back → OPEN, payment.state PAID
//
//   node docs/payments/simulate-spt.mjs [--max 100] [--prompt "…"] [--expect Paris]
//
// Env: MARKETPLACE_URL (default http://localhost:3000/mcp; the server must run with PAYMENT_MODE=mpp),
//      STRIPE_SECRET_KEY (sk_test_…; read from .env at the repo root when not exported).
// Everything here is Stripe TEST MODE. The real showcase replaces steps 3–4 with the
// Link agent wallet (`link-cli mpp pay <payment_link> --test`), where a human approves the spend.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MCP_URL = process.env.MARKETPLACE_URL ?? "http://localhost:3000/mcp";
const STATE = path.join(ROOT, ".atm-state/buyer.json");
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

function stripeKey() {
  if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY;
  const line = fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n").find((l) => l.startsWith("STRIPE_SECRET_KEY="));
  const key = line?.split("=")[1]?.trim();
  if (!key?.startsWith("sk_test_")) throw new Error("STRIPE_SECRET_KEY (sk_test_…) not found in env or .env");
  return key;
}

// ---- minimal MCP client (same shape as scripts/buyer.mjs) -----------------
let sid = null;
const rawFetch = globalThis.fetch; // keep a payment-unaware fetch for the MCP calls and the 402 demo
async function rpc(method, params, key) {
  const res = await rawFetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(sid ? { "mcp-session-id": sid } : {}), ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  sid = res.headers.get("mcp-session-id") ?? sid;
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  const json = JSON.parse(line ? line.slice(5) : text);
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json.result;
}
async function tool(name, a, key) {
  const r = await rpc("tools/call", { name, arguments: a }, key);
  const data = JSON.parse(r.content?.[0]?.text ?? "{}");
  if (r.isError) throw new Error(JSON.stringify(data.error ?? data));
  return data;
}

await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "atm-mpp-sim", version: "0.1" } });
const info = await tool("marketplace_info", {});
console.log(`payments: ${info.payments.mode} — ${info.payments.label}`);
if (info.payments.mode !== "mpp") { console.error("The server is not in PAYMENT_MODE=mpp; restart it with PAYMENT_MODE=mpp."); process.exit(1); }

let buyer = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : null;
if (!buyer) {
  const r = await tool("register_agent", { kind: "buyer", display_name: "mpp-demo-buyer", spend_cap_cents: 2000 });
  buyer = { agent_id: r.agent_id, api_key: r.api_key };
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(buyer, null, 2), { mode: 0o600 });
  console.log(`registered buyer ${r.agent_id}`);
}

// 1. post the task -------------------------------------------------------------
const max = Number(flag("max", 100));
const posted = await tool("post_task", {
  prompt: flag("prompt", "What is the capital of France? Answer in one word."),
  allowed_models: ["qwen3:8b"],
  max_price_cents: max,
  rubric: { kind: "contains_text", expected_text: flag("expect", "Paris") },
  max_tokens: 200,
}, buyer.api_key);
const task = posted.task;
console.log(`\n[1] post_task → ${task.task_id} status=${task.status} payment.state=${task.payment.state}`);
console.log(`    payment_link: ${task.payment.payment_link}`);

// 2. the 402 challenge ----------------------------------------------------------
const challengeRes = await rawFetch(task.payment.payment_link, { method: "POST" });
const www = challengeRes.headers.get("www-authenticate") ?? "";
console.log(`\n[2] POST payment_link (no credential) → HTTP ${challengeRes.status}`);
console.log(`    WWW-Authenticate: ${www.slice(0, 160)}${www.length > 160 ? "…" : ""}`);
if (challengeRes.status !== 402) { console.error(await challengeRes.text()); process.exit(1); }
const reqB64 = /request="([^"]+)"/.exec(www)?.[1];
if (reqB64) console.log(`    challenge.request: ${Buffer.from(reqB64, "base64url").toString("utf8")}`);

// 3 + 4. pay it with a test-mode Shared Payment Token ----------------------------
const { Mppx, stripe } = await import(path.join(ROOT, "apps/marketplace-mcp/node_modules/mppx/dist/client/index.js"));
const key = stripeKey();
async function createToken({ amount, currency, expiresAt, networkId, paymentMethod }) {
  // Stripe test helper: mints the token a Link wallet would issue after the human approves the spend.
  const body = new URLSearchParams({
    payment_method: paymentMethod,
    "usage_limits[currency]": currency,
    "usage_limits[max_amount]": String(amount),
    "usage_limits[expires_at]": String(expiresAt),
  });
  const res = await rawFetch("https://api.stripe.com/v1/test_helpers/shared_payment/granted_tokens", {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`granted_tokens: ${json.error?.message ?? res.status}`);
  console.log(`\n[3] test helper minted ${json.id} (max ${json.usage_limits?.max_amount}c, network ${networkId ?? "n/a"})`);
  return json.id;
}
Mppx.create({ methods: [stripe({ createToken, paymentMethod: "pm_card_visa" })] }); // polyfills fetch: 402 → credential → retry
const paid = await fetch(task.payment.payment_link, { method: "POST" });
const receipt = paid.headers.get("payment-receipt");
console.log(`\n[4] POST payment_link with credential → HTTP ${paid.status}`);
if (receipt) console.log(`    Payment-Receipt: ${Buffer.from(receipt, "base64url").toString("utf8")}`);
console.log(`    body: ${await paid.text()}`);

// 5. the task is listed ------------------------------------------------------------
const after = await tool("get_task", { task_id: task.task_id }, buyer.api_key);
console.log(`\n[5] get_task → status=${after.task.status} payment.state=${after.task.payment.state} pi=${after.task.payment.stripe_payment_intent_id}`);
const me = await tool("whoami", {}, buyer.api_key);
console.log(`    buyer spend: ${JSON.stringify(me.spend)}`);
