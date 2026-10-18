#!/usr/bin/env node
// Minimal buyer CLI (no MCP client dependency) for demos and tests.
//   node scripts/buyer.mjs post "<prompt>" --expect "Paris" [--models qwen3:8b] [--max 100]
//   node scripts/buyer.mjs result <task_id>     node scripts/buyer.mjs tasks     node scripts/buyer.mjs whoami
import fs from "node:fs";
import path from "node:path";
const URL = process.env.MARKETPLACE_URL ?? "http://localhost:3000/mcp";
const STATE = path.resolve(path.dirname(new globalThis.URL(import.meta.url).pathname), "../.atm-state/buyer.json");
let sid = null;
async function rpc(method, params, key) {
  const res = await fetch(URL, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(sid ? { "mcp-session-id": sid } : {}), ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  sid = res.headers.get("mcp-session-id") ?? sid;
  const text = await res.text(); const line = text.split("\n").find((l) => l.startsWith("data:"));
  const json = JSON.parse(line ? line.slice(5) : text); if (json.error) throw new Error(JSON.stringify(json.error)); return json.result;
}
async function tool(name, args, key) { const r = await rpc("tools/call", { name, arguments: args }, key); const data = JSON.parse(r.content?.[0]?.text ?? "{}"); if (r.isError) throw new Error(JSON.stringify(data.error ?? data)); return data; }
await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "atm-buyer-cli", version: "0.1" } });
let state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : null;
if (!state) {
  const r = await tool("register_agent", { kind: "buyer", display_name: process.env.USER ? `${process.env.USER}-buyer` : "demo-buyer", spend_cap_cents: Number(process.env.SPEND_CAP_CENTS ?? 2000) });
  state = { agent_id: r.agent_id, api_key: r.api_key }; fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(`registered buyer ${r.agent_id} (cap ${r.spend_cap_cents}c, stripe customer ${r.stripe?.customer_id})`);
}
const [cmd, ...rest] = process.argv.slice(2);
const flag = (n, d) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : d; };
const out = (o) => console.log(JSON.stringify(o, null, 2));
if (cmd === "post") {
  const prompt = rest.find((a) => !a.startsWith("--") && rest[rest.indexOf(a) - 1]?.startsWith("--") !== true) ?? rest[0];
  const rubric = flag("expect") ? { kind: "contains_text", expected_text: flag("expect") } : { kind: "llm_rubric", criteria: flag("criteria", "The answer is correct, complete and directly addresses the prompt.") };
  out(await tool("post_task", { prompt, context: flag("context"), allowed_models: flag("models", "qwen3:8b").split(","), max_price_cents: Number(flag("max", 100)), rubric, max_tokens: Number(flag("max-tokens", 400)) }, state.api_key));
} else if (cmd === "result") out(await tool("get_result", { task_id: rest[0] }, state.api_key));
else if (cmd === "task") out(await tool("get_task", { task_id: rest[0] }, state.api_key));
else if (cmd === "tasks") out((await tool("list_my_tasks", {}, state.api_key)).tasks.map((t) => ({ task_id: t.task_id, status: t.status, price: t.price_cents, payment: t.payment.state })));
else if (cmd === "whoami") out(await tool("whoami", {}, state.api_key));
else console.log("usage: buyer.mjs post <prompt> [--expect text|--criteria text] [--models a,b] [--max cents] | result <id> | task <id> | tasks | whoami");
