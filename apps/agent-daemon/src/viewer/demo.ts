/**
 * SIMULATED live-view demo: replays a scripted seller and judge run so the
 * page can be seen without Wassette, Ollama or a marketplace. Every event is
 * synthetic and the page shows a "SIMULATED DEMO DATA" label.
 *
 *   pnpm --filter @atm/agent-daemon live:demo
 */
import { startLiveView, type OpenMode } from "./server.js";

const open = (process.env.ATM_VIEWER_OPEN ?? "each") as OpenMode;
const view = await startLiveView({ port: Number(process.env.ATM_VIEWER_PORT ?? 4700), open, role: "seller", runtime: "wassette", marketplaceUrl: "http://127.0.0.1:3000/mcp (simulated)", tap: true, simulated: true });
console.log(`SIMULATED live view at ${view.url} (Ctrl-C to stop)`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SHA = "9f2c41d07be35a8e6f4c0d1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e";
const MKT = "http://127.0.0.1:41733", OLLAMA = "http://127.0.0.1:41734";
let net = 0;

async function call(vm: string, target: "marketplace" | "ollama", callName: string, req: unknown, res: unknown, ms: number) {
  const id = `${target}-${++net}`;
  view.emit({ t: "net", phase: "start", id, vm, target, method: target === "ollama" && callName === "/api/tags" ? "GET" : "POST", path: target === "ollama" ? callName : "/mcp", call: callName, req });
  await sleep(ms);
  view.emit({ t: "net", phase: "end", id, vm, status: 200, ms, ok: true, res });
}

async function boot(role: "seller" | "judge", network: string[], env: string[]) {
  const vm = view.vmStarted({ role, runtime: "wassette", wassette_version: "0.8.1", wasm_sha256: SHA, network, env });
  await sleep(500);
  view.vmUpdate(vm, { pid: 40000 + Math.floor(Math.random() * 9999) });
  view.stderr(vm, "INFO wassette: MCP server listening on stdio");
  const step = async (name: string, args: unknown, ms: number) => {
    view.step(vm, name, "start", { args });
    await sleep(ms);
    view.step(vm, name, "end", { ok: true, ms, result: { status: "ok" } });
  };
  await step("load-component", { path: `file:///.atm-state/wassette-${role}/session-x/atm-${role}-runner.wasm` }, 900);
  view.stderr(vm, `INFO wasmtime: compiled component atm-${role}-runner (cached)`);
  for (const host of network) await step("grant-network-permission", { host }, 120);
  for (const key of env) await step("grant-environment-variable-permission", { key }, 80);
  view.vmUpdate(vm, { state: "ready", component: `atm-${role}-runner` });
  return vm;
}

const ANSWER = `Here is a concise summary of the three trade-offs:

1. **Latency vs. cost** — running qwen3:8b on idle seller hardware takes a few seconds per task but costs a fraction of a hosted frontier model.
2. **Isolation** — the runner executes inside a Wasmtime component whose only network grants are the marketplace and the local Ollama endpoint.
3. **Verification** — the judge recomputes the sha256 commitment and grades the answer before any payout is captured.

Overall: offload bulk, well-specified tasks; keep ambiguous ones local.`;

async function sellerRun(vm: string, n: number) {
  const task = `task_demo${String(n).padStart(3, "0")}`;
  const claim = `claim_${Math.random().toString(36).slice(2, 10)}`;
  const opts = { marketplace_url: `${MKT}/mcp`, ollama_url: OLLAMA, task_id: task, model_id: "qwen3:8b", max_runtime_s: 180, expected_price_cents: 100 };
  view.step(vm, "run-cycle-measured", "start", { args: opts });
  view.vmUpdate(vm, { state: "busy" });
  const started = Date.now();
  await call(vm, "marketplace", "initialize", undefined, { protocolVersion: "2025-06-18" }, 90);
  await call(vm, "marketplace", "claim_task", { task_id: task, model_id: "qwen3:8b", runner_pubkey_b64: "q8Vf3x…", runner_key_id: "key_rk7" },
    { claim: { claim_id: claim, task_id: task, price_cents: 100, lease_expires_at: new Date(Date.now() + 300_000).toISOString(), seller_envelope: "xchacha20poly1305:AAEC… (2412 chars)" } }, 240);
  await call(vm, "marketplace", "start_task", { task_id: task, claim_id: claim }, { task: { status: "RUNNING" } }, 120);
  await call(vm, "ollama", "/api/tags", undefined, { models: ["qwen3:8b", "llama3.2:3b"] }, 30);
  const id = `ollama-${++net}`;
  const prompt = [
    { role: "system", content: "You are a worker model executing a task for another agent. Follow the instruction precisely and answer directly without preamble." },
    { role: "user", content: "Summarise the three main trade-offs of offloading LLM tasks to a peer marketplace of idle machines. Use a numbered list and finish with a one-line recommendation." },
  ];
  view.emit({ t: "net", phase: "start", id, vm, target: "ollama", method: "POST", path: "/api/chat", call: "/api/chat", req: { model: "qwen3:8b", messages: prompt, options: { num_predict: 512, temperature: 0.2 } } });
  const inferStart = Date.now();
  await sleep(1200); // model load + prompt eval
  const tokens = ANSWER.match(/\s*\S+/g) ?? [];
  for (const t of tokens) { view.emit({ t: "token", id, vm, text: t }); await sleep(35 + Math.random() * 45); }
  view.emit({ t: "net", phase: "end", id, vm, status: 200, ms: Date.now() - inferStart, ok: true, res: { content: ANSWER, eval_count: tokens.length, prompt_eval_count: 71, load_duration_ms: 940 } });
  const result = `res_${Math.random().toString(36).slice(2, 10)}`;
  await call(vm, "marketplace", "submit_result", { task_id: task, claim_id: claim, result_enc_buyer: "xchacha20poly1305:AAEC… (1890 chars)", result_enc_judge: "xchacha20poly1305:AAEC… (1890 chars)", commitment_sha256: "3b1f…e9", tokens_out: tokens.length },
    { result_id: result, task: { status: "JUDGING" } }, 260);
  view.step(vm, "run-cycle-measured", "end", { ok: true, ms: Date.now() - started, result: { ok: true, result: { task_id: task, claim_id: claim, result_id: result, runtime_ms: Date.now() - inferStart, tokens_out: tokens.length, price_cents: 100 } } });
  view.vmUpdate(vm, { state: "ready" });
  return { task, result };
}

async function judgeRun(vm: string, task: string, result: string) {
  view.step(vm, "judge-cycle", "start", { args: { marketplace_url: `${MKT}/mcp` } });
  view.vmUpdate(vm, { state: "busy" });
  const started = Date.now();
  await call(vm, "marketplace", "fetch_review_package", {}, { package: { task_id: task, result_id: result, task_enc_judge: "xchacha20poly1305:… (2412 chars)", result_enc_judge: "xchacha20poly1305:… (1890 chars)", rubric: { kind: "llm_rubric" } } }, 200);
  view.stderr(vm, "INFO wassette: outgoing request to api.anthropic.com allowed by policy");
  await sleep(2600);
  await call(vm, "marketplace", "submit_verdict", { task_id: task, result_id: result, verdict: "APPROVE", reason_code: "RUBRIC_PASSED", score: 0.92 }, { seller_status: "ACTIVE", settlement: { seller_payout_cents: 100, note: "Stripe TEST mode capture (simulated)" } }, 300);
  view.step(vm, "judge-cycle", "end", { ok: true, ms: Date.now() - started, result: { idle: false, kind: "verdict", task_id: task, result_id: result, verdict: "APPROVE", reason_code: "RUBRIC_PASSED", score: 0.92, seller_payout_cents: 100 } });
  view.vmUpdate(vm, { state: "ready" });
}

view.log("[seller] SIMULATED: marketplace http://127.0.0.1:3000/mcp");
await sleep(1500);
const seller = await boot("seller", [MKT, OLLAMA], ["AGENT_API_KEY"]);
let judge: string | undefined;
for (let n = 1; ; n++) {
  view.log(`[seller] SIMULATED: accepting task_demo${String(n).padStart(3, "0")} offer=100c model=qwen3:8b runtime=wassette`);
  const { task, result } = await sellerRun(seller, n);
  judge ??= await boot("judge", [MKT, "https://api.anthropic.com"], ["AGENT_API_KEY", "ANTHROPIC_API_KEY", "JUDGE_PRIVATE_KEY_B64"]);
  await judgeRun(judge, task, result);
  await sleep(5000);
}
