import { useEffect, useRef, type ReactNode } from "react";
import { Check, CircleAlert, Loader2, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGES, describe, fmtClock, fmtMs, type ChatMsg, type LiveModel, type LiveRun, type NetCall } from "@/lib/live";
import type { LiveConnection } from "@/hooks/live";
import { Badge } from "@/components/ui/badge";
import { Orb } from "@/components/ui/thinking-orbs";
import { ChatMessage, ChatMessageAvatar, ChatMessageContent } from "@/components/ui/chat-message";
import { ToolInvocation, ToolInvocationContentCollapsible, ToolInvocationName, ToolInvocationRawData } from "@/components/ui/tool-invocation";
import { ToolGroup } from "@/components/tool-group";

/**
 * The worker's current task, drawn like the buyer chat: the task prompt as a
 * user bubble, the model's answer streaming as the assistant, tool calls and
 * sandbox traffic folded into tool rows. One instance, one run, no history.
 */
export function LiveWorkspace({ model, connection, running }: { model: LiveModel; connection: LiveConnection; running: boolean }) {
  const { vm, run } = model;
  const head = running ? describe(model, connection === "open") : { label: "Activate seller mode to lend this computer.", state: "base" as const, tone: "muted" as const };
  return (
    <div className="flex min-h-[420px] flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-3.5">
        <div role="status" className="flex min-w-0 flex-1 items-center gap-2.5 text-[14px]">
          {head.state === "base" ? <span className={cn("size-2 rounded-full", head.tone === "danger" ? "bg-danger" : head.tone === "success" ? "bg-success" : "bg-muted-foreground")} aria-hidden /> : <Orb state={head.state} label={head.label} />}
          <span className={cn("truncate", head.tone === "danger" ? "text-danger" : head.tone === "success" ? "text-foreground" : "text-muted-foreground")}>{head.label}</span>
        </div>
        {vm && <VmMeta vm={vm} />}
      </div>
      {running && run ? <RunBody run={run} role={vm?.role ?? "seller"} /> : <Idle vm={vm} running={running} connection={connection} />}
      {running && model.log.length > 0 && (
        <div className="border-t border-border px-5 py-3">
          <ToolGroup summary="Event stream" className="max-w-none">
            <div className="scroll-thin max-h-64 overflow-auto p-3 font-mono text-[11.5px] leading-relaxed">
              {model.log.slice(-200).map((l, i) => (
                <div key={i} className="whitespace-pre-wrap break-words"><span className="text-muted-foreground/70">{new Date(l.at).toLocaleTimeString([], { hour12: false })}</span> <span className={cn("inline-block min-w-14", l.kind === "stderr" ? "text-warning" : l.kind === "vm" ? "text-success" : "text-info")}>{l.kind}</span> {l.text}</div>
              ))}
            </div>
          </ToolGroup>
        </div>
      )}
    </div>
  );
}

function VmMeta({ vm }: { vm: LiveModel["vm"] & object }) {
  const cpu = vm.cpu.at(-1), rss = vm.rss.at(-1);
  const up = (vm.closedAt ?? Date.now()) - vm.startedAt;
  const tone = vm.state === "crashed" ? "danger" : vm.state === "busy" ? "info" : vm.state === "ready" ? "success" : "muted";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
      <Badge tone={tone} dot={vm.state === "busy" || vm.state === "ready"}>{vm.runtime === "node-unsandboxed" ? "UNSANDBOXED" : "Wasm sandbox"} · {vm.state}</Badge>
      <span className="font-mono">{vm.id}{vm.pid ? ` · pid ${vm.pid}` : ""} · {fmtClock(up)}</span>
      {cpu != null && <span className="font-mono">CPU {cpu.toFixed(0)}%</span>}
      {rss != null && <span className="font-mono">{(rss / 1048576).toFixed(0)} MB</span>}
    </div>
  );
}

function Idle({ vm, running, connection }: { vm: LiveModel["vm"]; running: boolean; connection: LiveConnection }) {
  const text = !running ? "When you activate seller mode, each task your worker takes on is shown here as it happens: the prompt, the model’s reasoning and answer, and what the sandbox sends over the network."
    : connection !== "open" ? "The worker reports its live view a few seconds after it starts."
    : vm?.closedAt ? "The sandbox instance has closed. A new one starts with the next task."
    : "The sandbox is ready. Open tasks that match your model are claimed automatically.";
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-14">
      <p className="max-w-md text-center text-[13px] leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function RunBody({ run, role }: { run: LiveRun; role: string }) {
  const live = run.status === "running";
  const inferring = run.stages.infer.state === "active";
  const answer = run.output || (typeof run.inferRes?.content === "string" ? run.inferRes.content : "");
  const stats = run.inferRes ?? {};
  const evalCount = typeof stats.eval_count === "number" ? stats.eval_count : undefined;
  const evalMs = typeof stats.eval_duration_ms === "number" ? stats.eval_duration_ms : undefined;
  const rate = evalCount && evalMs ? evalCount / (evalMs / 1000) : run.chunks > 1 && run.lastAt && run.firstAt && run.lastAt > run.firstAt ? (run.chunks - 1) / ((run.lastAt - run.firstAt) / 1000) : undefined;
  const meta = [
    run.taskId && <span key="task" className="font-mono">{run.taskId}</span>,
    run.model && <span key="model">{run.model}</span>,
    evalCount != null ? <span key="tok">{evalCount} tokens</span> : run.chunks > 0 ? <span key="chunks">{run.chunks} chunks</span> : null,
    rate ? <span key="rate">{rate.toFixed(1)} tok/s</span> : null,
    run.firstAt && run.inferStart ? <span key="first">first token {fmtMs(run.firstAt - run.inferStart)}</span> : null,
    typeof stats.load_duration_ms === "number" ? <span key="load">model load {fmtMs(stats.load_duration_ms)}</span> : null,
    <span key="elapsed">{live ? `${fmtClock(Date.now() - run.startedAt)} elapsed` : `${fmtMs(run.ms ?? ((run.endedAt ?? run.startedAt) - run.startedAt))} total`}</span>,
  ].filter(Boolean);

  return (
    <div className="flex flex-1 flex-col gap-5 px-5 py-5">
      <Stages run={run} />
      <div className="flex flex-col gap-5">
        {run.prompt?.length ? run.prompt.map((m, i) => <Message key={i} m={m} />) : (
          <p className="text-[13px] text-muted-foreground">{role === "judge" ? "The judge grades through TLS; the review package and verdict appear here." : inferring || run.stages.infer.state === "pending" ? "The prompt appears when the sandbox calls the model." : "Prompt not captured for this run."}</p>
        )}
        {(run.thinking || answer || inferring) && (
          <ChatMessage role="assistant">
            <ChatMessageAvatar role="assistant" />
            <ChatMessageContent role="assistant" className="max-w-[92%]">
              {run.thinking && (
                <ToolGroup summary={inferring && !answer ? "Reasoning…" : "Reasoning"} running={inferring && !answer} defaultOpen={live} className="mb-2 max-w-none">
                  <pre className="scroll-thin max-h-72 overflow-auto whitespace-pre-wrap break-words p-3 font-sans text-[13px] leading-relaxed text-muted-foreground">{run.thinking}</pre>
                </ToolGroup>
              )}
              {answer ? <Streamed text={answer} live={inferring} /> : inferring && !run.thinking ? <span className="inline-flex items-center gap-2 text-muted-foreground"><Orb state="working" label="Working" />Loading the model…</span> : null}
            </ChatMessageContent>
          </ChatMessage>
        )}
        {run.status === "failed" && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /><span>This task failed with <code className="font-mono">{run.error ?? "an unknown error"}</code>. The worker released it and keeps watching for the next one.</span>
          </div>
        )}
        {run.status === "done" && run.result && <Outcome run={run} role={role} />}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">{meta}</div>
      {run.nets.length > 0 && (
        <ToolGroup summary={`${run.nets.length} sandbox ${run.nets.length === 1 ? "call" : "calls"}`} running={live && run.nets.some((n) => n.status == null)} className="max-w-none">
          {run.nets.map((n) => <NetRow key={n.id} n={n} />)}
        </ToolGroup>
      )}
    </div>
  );
}

function Stages({ run }: { run: LiveRun }) {
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Task stages">
      {STAGES.map((s) => {
        const st = run.stages[s.key];
        const icon = st.state === "done" ? <Check className="size-3" /> : st.state === "failed" ? <CircleAlert className="size-3" /> : st.state === "active" ? <Loader2 className="size-3 animate-spin" /> : <Minus className="size-3" />;
        return (
          <li key={s.key} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium",
            st.state === "done" ? "border-success/30 bg-success-soft text-success" : st.state === "failed" ? "border-danger/30 bg-danger-soft text-danger"
            : st.state === "active" ? "border-info/40 bg-info-soft text-info" : "border-border text-muted-foreground", st.state === "skipped" && "opacity-50")}>
            {icon}{s.label}{st.ms != null && st.state !== "active" && <span className="font-mono font-normal opacity-70">{fmtMs(st.ms)}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Message({ m }: { m: ChatMsg }) {
  if (m.role === "user") {
    return (
      <ChatMessage role="user"><ChatMessageAvatar role="user" /><ChatMessageContent role="user" label="Task prompt">{m.content ?? ""}</ChatMessageContent></ChatMessage>
    );
  }
  if (m.role === "system") {
    return (
      <ToolInvocation className="max-w-[600px]">
        <ToolInvocationContentCollapsible header={<ToolInvocationName name="system" label="Worker instructions" type="output-available" />}>
          <ToolInvocationRawData title="System prompt" data={m.content ?? ""} />
        </ToolInvocationContentCollapsible>
      </ToolInvocation>
    );
  }
  if (m.role === "tool") {
    return (
      <ToolInvocation className="max-w-[600px]">
        <ToolInvocationContentCollapsible header={<ToolInvocationName name={m.tool_name ?? "tool"} label={`Tool result · ${m.tool_name ?? "tool"}`} type="output-available" />}>
          <ToolInvocationRawData title="Result" data={parse(m.content)} />
        </ToolInvocationContentCollapsible>
      </ToolInvocation>
    );
  }
  // An earlier assistant turn, already acted on by the sandbox.
  return (
    <ChatMessage role="assistant">
      <ChatMessageAvatar role="assistant" />
      <ChatMessageContent role="assistant" className="max-w-[92%]">
        {m.thinking && <ToolGroup summary="Reasoning" className="mb-2 max-w-none"><pre className="scroll-thin max-h-72 overflow-auto whitespace-pre-wrap break-words p-3 font-sans text-[13px] leading-relaxed text-muted-foreground">{m.thinking}</pre></ToolGroup>}
        {m.content && <div className="whitespace-pre-wrap">{m.content}</div>}
        {m.tool_calls?.length ? (
          <div className="mt-2 flex flex-col gap-1.5">
            {m.tool_calls.map((c, i) => (
              <ToolInvocation key={i} className="max-w-[600px]">
                <ToolInvocationContentCollapsible header={<ToolInvocationName name={c.function?.name ?? "tool"} label={`Used ${c.function?.name ?? "a tool"}`} type="output-available" />}>
                  <ToolInvocationRawData title="Arguments" data={c.function?.arguments} />
                </ToolInvocationContentCollapsible>
              </ToolInvocation>
            ))}
          </div>
        ) : null}
      </ChatMessageContent>
    </ChatMessage>
  );
}

/** Streaming answer that follows the newest text unless the reader scrolled up. */
function Streamed({ text, live }: { text: string; live: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40 - 24) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <div ref={ref} className="scroll-thin max-h-[480px] overflow-auto whitespace-pre-wrap break-words">
      {text}{live && <span className="ml-0.5 inline-block h-[1em] w-[7px] translate-y-[2px] animate-pulse rounded-[2px] bg-foreground/70" aria-hidden />}
    </div>
  );
}

function Outcome({ run, role }: { run: LiveRun; role: string }) {
  const r = run.result ?? {};
  const inner = (r.result && typeof r.result === "object" ? r.result : r) as Record<string, unknown>;
  const parts: ReactNode[] = [];
  if (role === "judge") {
    if (inner.verdict) parts.push(<span key="v">verdict <b className="font-semibold">{String(inner.verdict)}</b>{inner.reason_code ? ` · ${String(inner.reason_code)}` : ""}</span>);
  } else {
    if (inner.result_id) parts.push(<span key="r" className="font-mono">{String(inner.result_id)}</span>);
    if (typeof inner.price_cents === "number") parts.push(<span key="p">{inner.price_cents}¢ offered</span>);
    if (typeof inner.tokens_out === "number") parts.push(<span key="t">{inner.tokens_out} tokens</span>);
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-success/30 bg-success-soft px-3.5 py-2.5 text-[12.5px] text-success">
      <Check className="size-4" aria-hidden />
      <span>{role === "judge" ? "Verdict submitted." : "Sealed and submitted. The judge reviews it before any payout."}</span>
      {parts}
    </div>
  );
}

function NetRow({ n }: { n: NetCall }) {
  const type = n.status == null ? "input-available" : n.ok ? "output-available" : "output-error";
  return (
    <ToolInvocation className="rounded-none border-0 bg-transparent">
      <ToolInvocationContentCollapsible header={<ToolInvocationName name={`${n.target} · ${n.ms != null ? fmtMs(n.ms) : "…"}`} label={n.call} type={type} />}>
        <ToolInvocationRawData title="Request" data={n.req} />
        <ToolInvocationRawData title="Response" data={n.res ?? n.error} />
      </ToolInvocationContentCollapsible>
    </ToolInvocation>
  );
}

function parse(text?: string): unknown {
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return text; }
}
