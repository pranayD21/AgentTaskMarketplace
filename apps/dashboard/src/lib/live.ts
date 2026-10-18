// Reduces the worker's live-view event stream (relayed by the daemon at
// /api/live) into one picture: the sandbox instance doing work right now and
// the task it is on. Past instances and past runs are not kept; a new run
// replaces the previous one, whether that one finished, failed or crashed.

export type LiveEvent = Record<string, unknown> & { t: string; at?: number; seq?: number };

export type StageKey = "claim" | "start" | "keys" | "tags" | "infer" | "submit";
export type StageState = "pending" | "active" | "done" | "failed" | "skipped";
export const STAGES: { key: StageKey; label: string; call: string }[] = [
  { key: "claim", label: "Claim", call: "claim_task" },
  { key: "start", label: "Start", call: "start_task" },
  { key: "keys", label: "Keys", call: "get_recipient_keys" },
  { key: "tags", label: "Model check", call: "/api/tags" },
  { key: "infer", label: "Inference", call: "/api/chat" },
  { key: "submit", label: "Submit", call: "submit_result" },
];
const CYCLES = new Set(["run-cycle", "run-cycle-measured", "judge-cycle", "model-canary", "run-task", "judge-task"]);
export const TASK_TAKEN = "Another agent took the task before you.";
const claimTaken = (value: unknown) => typeof value === "string" && value.includes("CLAIM_CONFLICT");

export interface ChatMsg { role: string; content?: string; thinking?: string; tool_calls?: { function?: { name?: string; arguments?: unknown } }[]; tool_name?: string }
export interface NetCall { id: string; target: string; call: string; method?: string; startAt: number; status?: number; ms?: number; ok?: boolean; missed?: boolean; req?: unknown; res?: unknown; error?: string }
export interface LiveRun {
  n: number; kind: string; status: "running" | "done" | "failed" | "missed"; startedAt: number; endedAt?: number; ms?: number;
  taskId?: string; stages: Record<StageKey, { state: StageState; ms?: number }>;
  model?: string; prompt?: ChatMsg[]; inferId?: string; inferStart?: number;
  output: string; thinking: string; chunks: number; firstAt?: number; lastAt?: number;
  inferRes?: Record<string, unknown>; result?: Record<string, unknown>; error?: string; nets: NetCall[];
}
export interface LiveVm {
  id: string; role: string; runtime: string; state: string; pid: number | null; version?: string | null; sha?: string | null;
  grants: string[]; env: string[]; startedAt: number; readyAt?: number; closedAt?: number; reason?: string; cpu: number[]; rss: number[];
}
export interface LogLine { at: number; kind: string; text: string }
export interface LiveHello { role?: string; runtime?: string; marketplace?: string; tap?: boolean; simulated?: boolean }
export interface LiveModel { hello?: LiveHello; vm?: LiveVm; run?: LiveRun; runs: number; log: LogLine[] }

export const createModel = (): LiveModel => ({ runs: 0, log: [] });

const now = (e: LiveEvent) => (typeof e.at === "number" ? e.at : Date.now());
const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
const stages = (): LiveRun["stages"] => ({ claim: { state: "pending" }, start: { state: "pending" }, keys: { state: "pending" }, tags: { state: "pending" }, infer: { state: "pending" }, submit: { state: "pending" } });
const stageFor = (call: string | undefined) => STAGES.find((s) => call === s.call || (s.call.startsWith("/") && call?.startsWith(s.call)))?.key;

function pushLog(m: LiveModel, at: number, kind: string, text: string) {
  m.log.push({ at, kind, text });
  if (m.log.length > 400) m.log.splice(0, m.log.length - 400);
}

function newRun(m: LiveModel, kind: string, at: number): LiveRun {
  const run: LiveRun = { n: ++m.runs, kind, status: "running", startedAt: at, stages: stages(), output: "", thinking: "", chunks: 0, nets: [] };
  m.run = run;
  return run;
}
/** Traffic outside a cycle (node runtime, canaries) still belongs to a run. */
const currentRun = (m: LiveModel, at: number) => (m.run && m.run.status === "running" ? m.run : newRun(m, "implicit", at));

export function apply(m: LiveModel, e: LiveEvent) {
  const at = now(e);
  switch (e.t) {
    case "hello": m.hello = e as LiveHello; break;
    case "vm": {
      const id = String(e.vm);
      // A newer instance always wins; the previous one is gone with its run.
      if (!m.vm || m.vm.id !== id) {
        if (m.vm && !m.vm.closedAt && m.run?.status === "running") { /* the old instance is superseded; its run is dropped */ }
        m.vm = { id, role: str(e.role) ?? m.hello?.role ?? "seller", runtime: str(e.runtime) ?? "?", state: "booting", pid: null, grants: [], env: [], startedAt: at, cpu: [], rss: [] };
        m.run = undefined;
      }
      const vm = m.vm;
      if (e.role) vm.role = String(e.role);
      if (e.runtime) vm.runtime = String(e.runtime);
      if (e.wassette_version !== undefined) vm.version = str(e.wassette_version) ?? null;
      if (e.wasm_sha256 !== undefined) vm.sha = str(e.wasm_sha256) ?? null;
      if (Array.isArray(e.network)) vm.grants = e.network.map(String);
      if (Array.isArray(e.env)) vm.env = e.env.map(String);
      if (typeof e.pid === "number") vm.pid = e.pid;
      if (typeof e.state === "string") {
        vm.state = e.state;
        if (e.state === "ready" && !vm.readyAt) vm.readyAt = at;
        if (e.state === "closed" || e.state === "crashed") {
          vm.closedAt = at; vm.reason = str(e.reason);
          if (m.run?.status === "running") {
            const missed = m.run.nets.some((n) => n.missed);
            m.run.status = missed ? "missed" : "failed"; m.run.error = missed ? undefined : str(e.reason) ?? e.state; m.run.endedAt = at;
          }
        }
      }
      pushLog(m, at, "vm", m.run?.status === "missed" && (e.state === "closed" || e.state === "crashed") ? TASK_TAKEN
        : [e.state ? `state → ${e.state}` : "instance", e.pid ? `pid ${e.pid}` : "", e.reason && e.reason !== "closed" ? `(${e.reason})` : ""].filter(Boolean).join(" "));
      break;
    }
    case "step": {
      const name = String(e.name);
      if (CYCLES.has(name)) {
        if (e.phase === "start") {
          const run = newRun(m, name, at);
          const args = e.args as Record<string, unknown> | undefined;
          run.taskId = str(args?.task_id);
          if (m.vm) m.vm.state = "busy";
        } else {
          const run = m.run;
          if (m.vm && m.vm.state === "busy") m.vm.state = "ready";
          if (!run) break;
          const result = e.result as Record<string, unknown> | undefined;
          if (result?.idle === true) { m.run = undefined; m.runs--; break; }
          run.endedAt = at; run.ms = typeof e.ms === "number" ? e.ms : undefined;
          const missed = !e.ok && (claimTaken(e.error) || run.nets.some((n) => n.missed));
          run.status = missed ? "missed" : e.ok ? "done" : "failed"; run.result = result; run.error = missed ? undefined : str(e.error);
          const inner = result?.result as Record<string, unknown> | undefined;
          run.taskId ??= str(inner?.task_id ?? result?.task_id);
          for (const st of Object.values(run.stages)) {
            if (st.state === "active") st.state = missed ? "skipped" : e.ok ? "done" : "failed";
            else if (st.state === "pending" && e.ok) st.state = "skipped";
          }
          pushLog(m, at, "cycle", missed ? TASK_TAKEN : `${name} ${e.ok ? "finished" : "failed"}${run.ms != null ? ` in ${run.ms} ms` : ""}${run.error ? ` · ${run.error}` : ""}`);
        }
      } else if (e.phase === "end") {
        const args = e.args as Record<string, unknown> | undefined;
        pushLog(m, at, "call", `${name}${args?.host ? ` ${args.host}` : args?.key ? ` ${args.key}` : ""} → ${e.ok ? "ok" : `failed ${e.error ?? ""}`}`);
      }
      break;
    }
    case "net": {
      const id = String(e.id);
      if (e.phase === "start") {
        const run = currentRun(m, at);
        const rec: NetCall = { id, target: String(e.target ?? ""), call: String(e.call ?? ""), method: str(e.method), startAt: at, req: e.req };
        run.nets.push(rec);
        const req = e.req as Record<string, unknown> | undefined;
        run.taskId ??= str(req?.task_id);
        const st = stageFor(rec.call);
        if (st) {
          run.stages[st] = { state: "active" };
          if (st === "infer") {
            if (run.stages.keys.state === "pending") run.stages.keys.state = "skipped";
            run.prompt = Array.isArray(req?.messages) ? (req!.messages as ChatMsg[]) : undefined;
            run.model = str(req?.model);
            run.output = ""; run.thinking = ""; run.chunks = 0; run.firstAt = undefined; run.lastAt = undefined; run.inferStart = at; run.inferId = id; run.inferRes = undefined;
          }
        }
        pushLog(m, at, rec.target, `→ ${rec.method ?? ""} ${rec.call}`);
      } else {
        const run = m.run;
        const rec = run?.nets.find((n) => n.id === id);
        if (!run || !rec) break;
        rec.status = typeof e.status === "number" ? e.status : undefined; rec.ms = typeof e.ms === "number" ? e.ms : undefined;
        rec.missed = rec.call === "claim_task" && (claimTaken(e.error) || claimTaken(JSON.stringify(e.res ?? "")));
        rec.ok = Boolean(e.ok); rec.res = rec.missed ? { message: TASK_TAKEN } : e.res; rec.error = rec.missed ? undefined : str(e.error);
        const st = stageFor(rec.call);
        if (st) run.stages[st] = { state: rec.missed ? "skipped" : e.ok ? "done" : "failed", ms: rec.ms };
        if (st === "infer" && e.res && typeof e.res === "object") run.inferRes = e.res as Record<string, unknown>;
        if (rec.call === "claim_task" && e.ok) { const claim = (e.res as { claim?: { task_id?: string } } | undefined)?.claim; run.taskId = str(claim?.task_id) ?? run.taskId; }
        if (rec.call === "release_task") { run.status = "failed"; run.error ??= "released"; }
        pushLog(m, at, rec.target, rec.missed ? TASK_TAKEN : `← ${rec.call} ${rec.status ?? ""}${rec.error ? ` ${rec.error}` : ""}${rec.ms != null ? ` (${rec.ms} ms)` : ""}`);
      }
      break;
    }
    case "token": {
      const run = currentRun(m, at);
      run.output += typeof e.text === "string" ? e.text : "";
      run.thinking += typeof e.thinking === "string" ? e.thinking : "";
      run.chunks++; run.firstAt ??= at; run.lastAt = at;
      break;
    }
    case "stats": {
      if (!m.vm || m.vm.id !== String(e.vm)) break;
      m.vm.cpu.push(Number(e.cpu)); m.vm.rss.push(Number(e.rss));
      if (m.vm.cpu.length > 60) { m.vm.cpu.shift(); m.vm.rss.shift(); }
      break;
    }
    case "stderr": pushLog(m, at, claimTaken(e.line) ? "log" : "stderr", claimTaken(e.line) ? TASK_TAKEN : String(e.line ?? "")); break;
    case "log": pushLog(m, at, "log", claimTaken(e.line) ? TASK_TAKEN : String(e.line ?? "")); break;
  }
}

/** What the header should say, in the order a seller cares about. */
export function describe(m: LiveModel, connected: boolean): { label: string; state: "waiting" | "working" | "reasoning" | "base"; tone: "muted" | "info" | "success" | "danger" } {
  if (!connected) return { label: "Connecting to your worker…", state: "waiting", tone: "muted" };
  const { vm, run } = m;
  if (!vm) return { label: "Starting the sandbox…", state: "waiting", tone: "muted" };
  if (vm.state === "booting") return { label: "Booting the sandbox…", state: "working", tone: "info" };
  if (vm.closedAt && !run) return { label: vm.state === "crashed" ? `Sandbox crashed · ${vm.reason ?? ""}` : "Sandbox closed", state: "base", tone: vm.state === "crashed" ? "danger" : "muted" };
  if (!run) return { label: "Waiting for an eligible task…", state: "waiting", tone: "muted" };
  if (run.status === "missed") return { label: TASK_TAKEN, state: "base", tone: "muted" };
  if (run.status === "failed") return { label: `Task failed · ${run.error ?? "unknown"}`, state: "base", tone: "danger" };
  if (run.status === "done") return { label: vm.role === "judge" ? "Verdict submitted" : "Output submitted · awaiting review", state: "base", tone: "success" };
  if (run.stages.infer.state === "active") return { label: run.thinking && !run.output ? "Reasoning…" : run.output ? "Writing the answer…" : "Loading the model…", state: run.thinking && !run.output ? "reasoning" : "working", tone: "info" };
  if (run.stages.submit.state === "active") return { label: "Sealing and submitting…", state: "working", tone: "info" };
  if (run.stages.claim.state === "active") return { label: "Claiming a task…", state: "working", tone: "info" };
  return { label: "Working on a task…", state: "working", tone: "info" };
}

export const fmtMs = (ms?: number) => (ms == null ? "" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);
export const fmtClock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
