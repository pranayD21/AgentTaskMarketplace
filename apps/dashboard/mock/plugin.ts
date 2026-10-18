// Development-only stand-in for the daemon's loopback API. It is never served by
// the daemon and labels itself MOCK in the UI. No marketplace, Google, Stripe or
// Ollama calls happen here; every state transition is local and synthetic.
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import { randomUUID } from "node:crypto";

type Event = Record<string, unknown> & { type: string; at: string };
type Run = { id: string; prompt: string; model: string; status: string; events: Event[]; task_ids: string[]; mode: string; conversation_id: string; error?: string; task_prompts: Record<string, string> };

export function mockDashboardApi(): Plugin {
  const state = {
    owner: null as null | { user_id: string; email: string },
    buyerLinked: false, buying: "SETUP_REQUIRED", prepared: false, payout: "UNAVAILABLE", service: "stopped",
    busy: false, phase: "Ready to set up your account", error: null as string | null,
    runs: [] as Run[], sellerModel: "",
  };
  const models = [
    { name: "qwen3:8b", size: 5.2e9, parameters: "8.2B", quantization: "Q4_K_M" },
    { name: "llama3.2:3b", size: 2.0e9, parameters: "3.2B", quantization: "Q4_K_M" },
    { name: "gemma3:12b", size: 8.1e9, parameters: "12.2B", quantization: "Q4_K_M" },
  ];
  const now = () => new Date().toISOString();
  const json = (res: ServerResponse, status: number, value: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
  const body = async (req: IncomingMessage) => { let text = ""; for await (const chunk of req) text += chunk; return text ? JSON.parse(text) : {}; };
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function simulate(run: Run) {
    const push = (e: Record<string, unknown> & { type: string }) => run.events.push({ ...e, at: now() });
    const stream = async (turn: number, text: string, thinking = "") => {
      let content = "";
      for (const word of text.split(" ")) { content += (content ? " " : "") + word; const last = run.events.at(-1); const delta = { type: "model_delta", turn, content, thinking, duration_ms: 0 }; if (last?.type === "model_delta" && last.turn === turn) Object.assign(last, delta, { at: now() }); else push(delta); await delay(45); }
      run.events = run.events.filter((e) => !(e.type === "model_delta" && e.turn === turn));
    };
    try {
      await stream(0, "", "The user wants a comparison across three cloud regions. Each region is independent, so I can delegate the three lookups and combine them.");
      await stream(0, "I'll split this into independent parts: one network task per region, then combine the results here.");
      push({ type: "model", turn: 0, message: { role: "assistant", content: "I'll split this into independent parts: one network task per region, then combine the results here.", thinking: "The user wants a comparison across three cloud regions. Each region is independent, so I can delegate the three lookups and combine them.", tool_calls: [{ function: { name: "local_capacity", arguments: {} } }] } });
      push({ type: "tool_call", turn: 0, name: "local_capacity", arguments: {} });
      await delay(500);
      push({ type: "tool_result", turn: 0, name: "local_capacity", result: { cpu_cores: os.cpus().length, free_memory_gb: 12.4, system_load: 1.8, local_parallel_subagents: false, loaded_models: [], delegation_ceiling_test_cents: 200 } });
      push({ type: "tool_call", turn: 1, name: "mcp_list_sellers", arguments: { model_id: run.model } });
      await delay(700);
      push({ type: "tool_result", turn: 1, name: "mcp_list_sellers", result: { sellers: [{ seller_id: "seller_demo_mac", display_name: "studio-mac", models: ["qwen3:8b"], runtime: "wassette" }] } });
      for (const region of ["us-east-1", "eu-west-1", "ap-southeast-1"]) {
        if (run.status !== "running") return;
        const id = `task_${randomUUID().slice(0, 8)}`;
        const prompt = `List the three most recent compute instance families launched in ${region} with their vCPU and memory, one per line.`;
        push({ type: "tool_call", turn: 2, name: "mcp_post_task", arguments: { prompt, allowed_models: [run.model], price_cents: 50 } });
        await delay(600);
        run.task_ids.push(id); run.task_prompts[id] = prompt;
        push({ type: "tool_result", turn: 2, name: "mcp_post_task", result: { task: { task_id: id, status: "OPEN", price_cents: 50 } } });
        push({ type: "task_status", task: { task_id: id, status: "OPEN", price_cents: 50 } });
      }
      await stream(3, "Three tasks are posted. While workers run them, I'll prepare the comparison table format.");
      push({ type: "model", turn: 3, message: { role: "assistant", content: "Three tasks are posted. While workers run them, I'll prepare the comparison table format." } });
      run.status = "waiting";
      for (const [step, status] of [["CLAIMED", 1500], ["RUNNING", 1200], ["SUBMITTED", 3500], ["APPROVED", 2500]] as const) {
        await delay(status);
        for (const id of run.task_ids) {
          if (run.status === "stopped") return;
          push({ type: "task_status", task: { task_id: id, status: step, seller_id: "seller_demo_mac", model_id: run.model, claim_id: "claim_1" } });
          if (step === "SUBMITTED") push({ type: "remote_preview", task_id: id, seller_id: "seller_demo_mac", status: step, answer: `m8g.large — 2 vCPU, 8 GiB\nc8g.large — 2 vCPU, 4 GiB\nr8g.large — 2 vCPU, 16 GiB` });
          if (step === "APPROVED") push({ type: "remote_answer", task_id: id, seller_id: "seller_demo_mac", status: step, answer: `m8g.large — 2 vCPU, 8 GiB\nc8g.large — 2 vCPU, 4 GiB\nr8g.large — 2 vCPU, 16 GiB`, verdict: "APPROVE" });
        }
      }
      run.status = "running";
      push({ type: "resumed", tasks: run.task_ids });
      await stream(4, "All three regions report the same latest families: m8g, c8g and r8g at the .large size (2 vCPU; 8, 4 and 16 GiB). Workers passed the completion-format check only, so verify any figure you plan to rely on.");
      push({ type: "model", turn: 4, message: { role: "assistant", content: "All three regions report the same latest families: m8g, c8g and r8g at the .large size (2 vCPU; 8, 4 and 16 GiB). Workers passed the completion-format check only, so verify any figure you plan to rely on." } });
      push({ type: "stopped", reason: "model_finished", complete: false });
      run.status = "finished";
    } catch { run.status = "failed"; run.error = "Mock run failed."; }
  }

  // ---- SIMULATED live view: the same event shapes the worker's viewer emits ----
  const live = { history: [] as Record<string, unknown>[], clients: new Set<ServerResponse>(), seq: 0, running: false, net: 0 };
  const emit = (e: Record<string, unknown>) => {
    const frame = { ...e, seq: ++live.seq, at: Date.now() };
    if (e.t !== "stats") live.history.push(frame);
    const data = `data: ${JSON.stringify(frame)}\n\n`;
    for (const client of live.clients) client.write(data);
  };
  const selling = () => state.service === "running";
  async function call(vm: string, target: "marketplace" | "ollama", name: string, req: unknown, res: unknown, ms: number, ok = true) {
    const id = `${target}-${++live.net}`;
    emit({ t: "net", phase: "start", id, vm, target, method: name === "/api/tags" ? "GET" : "POST", path: target === "ollama" ? name : "/mcp", call: name, req });
    await delay(ms);
    emit({ t: "net", phase: "end", id, vm, status: ok ? 200 : 500, ms, ok, res: ok ? res : undefined, error: ok ? undefined : String(res) });
  }
  const ANSWER = "Here are the three instance families most recently launched in us-east-1:\n\n1. c8g.large — 2 vCPU, 4 GiB\n2. m8g.xlarge — 4 vCPU, 16 GiB\n3. r8g.2xlarge — 8 vCPU, 64 GiB\n\nAll three are Graviton4 based and generally available.";
  async function simulateWorker() {
    if (live.running) return;
    live.running = true; live.history = []; live.net = 0;
    emit({ t: "hello", role: "seller", runtime: "wassette", marketplace: "http://127.0.0.1:3000/mcp (simulated)", tap: true, simulated: true });
    emit({ t: "log", line: "[seller] SIMULATED worker for the mock dashboard" });
    await delay(800);
    const vm = "vm-1";
    emit({ t: "vm", vm, role: "seller", runtime: "wassette", wassette_version: "0.8.1", wasm_sha256: "9f2c41d07be35a8e6f4c0d1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e", network: ["http://127.0.0.1:41733", "http://127.0.0.1:41734"], env: ["AGENT_API_KEY"], state: "booting" });
    await delay(400); emit({ t: "vm", vm, pid: 48123 });
    for (const name of ["load-component", "grant-network-permission", "grant-environment-variable-permission"]) { emit({ t: "step", vm, name, phase: "start", args: {} }); await delay(250); emit({ t: "step", vm, name, phase: "end", ok: true, ms: 250 }); }
    emit({ t: "vm", vm, state: "ready", component: "atm-seller-runner" });
    const stats = setInterval(() => emit({ t: "stats", vm, cpu: 12 + Math.random() * 60, rss: (380 + Math.random() * 40) * 1048576 }), 1000);
    try {
      for (let n = 1; selling(); n++) {
        await delay(4000);
        if (!selling()) break;
        const task = `task_sim${String(n).padStart(3, "0")}`, claim = `claim_${n}`;
        const fails = n % 3 === 2; // every third task fails inside inference, then the next one must still show up
        emit({ t: "log", line: `[seller] accepting ${task} offer=100c model=qwen3:8b runtime=wassette` });
        emit({ t: "step", vm, name: "run-cycle-measured", phase: "start", args: { task_id: task, model_id: "qwen3:8b", max_runtime_s: 180, expected_price_cents: 100 } });
        emit({ t: "vm", vm, state: "busy" });
        const started = Date.now();
        await call(vm, "marketplace", "claim_task", { task_id: task, model_id: "qwen3:8b" }, { claim: { claim_id: claim, task_id: task, price_cents: 100 } }, 300);
        await call(vm, "marketplace", "start_task", { task_id: task, claim_id: claim }, { task: { status: "RUNNING" } }, 150);
        await call(vm, "ollama", "/api/tags", undefined, { models: ["qwen3:8b"] }, 40);
        const id = `ollama-${++live.net}`;
        const messages = [
          { role: "system", content: "You are a worker model executing a task for another agent. Use available tools when useful, then return the requested deliverable." },
          { role: "user", content: `List the three most recent compute instance families launched in us-east-1 with their vCPU and memory, one per line. (${task})` },
        ];
        emit({ t: "net", phase: "start", id, vm, target: "ollama", method: "POST", path: "/api/chat", call: "/api/chat", req: { model: "qwen3:8b", messages, options: { num_thread: os.cpus().length, num_ctx: 16384 } } });
        const inferStart = Date.now();
        await delay(900);
        for (const word of "The user wants three recent instance families. I know the Graviton4 generation launched recently, so I will list those with their shapes.".split(" ")) { emit({ t: "token", id, vm, text: "", thinking: `${word} ` }); await delay(40); }
        if (fails) {
          await delay(600);
          emit({ t: "net", phase: "end", id, vm, status: 500, ms: Date.now() - inferStart, ok: false, error: "OLLAMA_HTTP_500" });
          await call(vm, "marketplace", "release_task", { task_id: task, claim_id: claim, reason: "OLLAMA_HTTP_500" }, { ok: true }, 120);
          emit({ t: "step", vm, name: "run-cycle-measured", phase: "end", ok: false, ms: Date.now() - started, error: "OLLAMA_HTTP_500" });
          emit({ t: "vm", vm, state: "ready" });
          emit({ t: "log", line: "seller: OLLAMA_HTTP_500" });
          continue;
        }
        const tokens = ANSWER.match(/\s*\S+/g) ?? [];
        for (const t of tokens) { if (!selling()) break; emit({ t: "token", id, vm, text: t }); await delay(45); }
        emit({ t: "net", phase: "end", id, vm, status: 200, ms: Date.now() - inferStart, ok: true, res: { content: ANSWER, eval_count: tokens.length, prompt_eval_count: 64, eval_duration_ms: tokens.length * 45, load_duration_ms: 820 } });
        const result = `res_${n}`;
        await call(vm, "marketplace", "submit_result", { task_id: task, claim_id: claim, commitment_sha256: "3b1f…e9", tokens_out: tokens.length }, { result_id: result, task: { status: "JUDGING" } }, 260);
        emit({ t: "step", vm, name: "run-cycle-measured", phase: "end", ok: true, ms: Date.now() - started, result: { ok: true, result: { task_id: task, claim_id: claim, result_id: result, runtime_ms: Date.now() - inferStart, tokens_out: tokens.length, price_cents: 100 } } });
        emit({ t: "vm", vm, state: "ready" });
      }
    } finally {
      clearInterval(stats);
      emit({ t: "vm", vm, state: "closed", reason: "closed" });
      for (const client of live.clients) client.end();
      live.clients.clear(); live.running = false;
    }
  }

  return {
    name: "atm-mock-dashboard-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname === "/" || url.pathname === "/task.html") { req.url = "/seller.html" + url.search; return next(); }
        if (url.pathname === "/auth/callback") { state.owner = { user_id: "human-mock", email: "you@example.test" }; state.buyerLinked = true; state.phase = "Google account linked. You can buy tasks and set up local selling."; res.writeHead(303, { Location: "/" }); return res.end(); }
        if (url.pathname === "/mock/stripe") {
          if (url.searchParams.get("kind") === "buying") state.buying = "READY"; else state.payout = "ACTIVE";
          res.writeHead(200, { "Content-Type": "text/html" });
          return res.end("<!doctype html><title>Mock Stripe</title><body style='font:15px -apple-system,sans-serif;padding:40px'><h1>Mock Stripe setup complete</h1><p>This stands in for Stripe's hosted TEST page. Close this tab and return to the dashboard.</p></body>");
        }
        if (!url.pathname.startsWith("/api/")) return next();
        if (req.method === "POST" && req.headers["x-atm-request"] !== "1") return json(res, 403, { error: "Invalid local request" });
        try {
          switch (`${req.method} ${url.pathname}`) {
            case "GET /api/status": {
              const load = os.loadavg()[0] ?? 0;
              return json(res, 200, {
                buyer_id: state.buyerLinked ? "buyer_mock" : null,
                buyer_payment: state.buyerLinked ? { buyer_payment_status: state.buying } : null,
                provider_budget: state.buyerLinked ? { remaining_microusd: 4997610, enforced: true, available: true } : null,
                machine: { hostname: os.hostname(), chip: os.cpus()[0]?.model ?? "Apple M-series", cpu_cores: os.cpus().length, memory_bytes: os.totalmem(), free_memory_bytes: os.freemem(), load_average_1m: load, ollama_online: true,
                  models, loaded_models: state.service === "running" ? [{ name: "qwen3:8b", size: 5.2e9, size_vram: 5.6e9 }] : [] },
                worker: { service: state.service, prepared: state.prepared, payout_status: state.payout, approvals: 7, server_reachable: true, viewer_url: state.service === "running" ? "http://127.0.0.1:0" : null, models: ["qwen3:8b"] },
                owner: state.owner, seller_id: state.owner ? "seller_mock_identity" : null, seller_model: state.sellerModel, allowed_models: ["qwen3:8b", "llama3.2:3b"],
                phase: state.phase, error: state.error, busy: state.busy, payments_label: "MOCK · LOCAL PREVIEW",
              });
            }
            case "POST /api/auth/google": return json(res, 200, { url: "/auth/callback" });
            case "POST /api/buyer-payment": return state.buying === "READY" ? json(res, 200, { buyer_payment_status: "READY" }) : json(res, 200, { buyer_payment_status: "SETUP_REQUIRED", setup_url: "/mock/stripe?kind=buying" });
            case "POST /api/payout": return state.payout === "ACTIVE" ? json(res, 200, { payout_status: "ACTIVE" }) : json(res, 200, { payout_status: "PENDING_ONBOARDING", payout_onboarding_url: "/mock/stripe?kind=payout" });
            case "POST /api/prepare": {
              if (state.busy) return json(res, 409, { error: "Setup is already running. See its progress below." });
              state.busy = true; state.error = null; state.phase = "Checking your installed models…";
              void (async () => { await delay(1500); state.phase = "Running the liveness canary in the Wasm sandbox…"; await delay(2500); state.prepared = true; state.phase = "Local model ready. Complete Stripe setup, then start selling."; state.busy = false; })();
              return json(res, 202, { ok: true });
            }
            case "POST /api/start": if (state.buying !== "READY") return json(res, 402, { error: "Complete Stripe buying setup before starting to sell." }); state.service = "running"; state.phase = "Seller started. Waiting for a matching task."; void simulateWorker(); return json(res, 200, { ok: true });
            case "POST /api/seller-model": { if (state.service === "running") return json(res, 409, { error: "Stop selling before changing the model." }); const { model } = await body(req); if (model && !models.some((m) => m.name === model)) return json(res, 400, { error: "Choose an installed model that the network accepts." }); state.sellerModel = String(model ?? ""); return json(res, 200, { seller_model: state.sellerModel }); }
            case "POST /api/stop": state.service = "stopped"; state.phase = "Seller stopped. Your identity and models are saved."; return json(res, 200, { ok: true });
            case "GET /api/live": {
              if (state.service !== "running") return json(res, 503, { error: "The worker is not running." });
              res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
              for (const e of live.history) res.write(`data: ${JSON.stringify(e)}\n\n`);
              live.clients.add(res);
              req.on("close", () => live.clients.delete(res));
              return;
            }
            case "GET /api/chat": return state.buyerLinked ? json(res, 200, { runs: state.runs }) : json(res, 400, { error: "Sign in with Google to use chat." });
            case "POST /api/chat": {
              const input = await body(req);
              if (state.buying !== "READY") return json(res, 402, { error: "Complete Stripe buying setup before sending requests." });
              const run: Run = { id: randomUUID(), prompt: String(input.prompt ?? ""), model: String(input.model ?? "qwen3:8b"), status: "running", events: [], task_ids: [], mode: "agent", conversation_id: String(input.conversation_id ?? randomUUID()), task_prompts: {} };
              state.runs.push(run); void simulate(run); return json(res, 202, { id: run.id });
            }
            case "POST /api/chat/stop": { const input = await body(req); const run = state.runs.find((r) => r.id === input.id); if (run && ["running", "waiting"].includes(run.status)) { run.status = "stopped"; run.error = "Chat stopped. Posted tasks remain visible and may still finish."; } return json(res, 200, { ok: true }); }
            default: return json(res, 404, { error: "Not found" });
          }
        } catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : "Mock error" }); }
      });
    },
  };
}
