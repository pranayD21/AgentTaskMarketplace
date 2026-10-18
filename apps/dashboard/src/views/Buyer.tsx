import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Check, Copy, Square } from "lucide-react";
import { api, type Run } from "@/lib/api";
import { ACTIVE_RUN, conversationOf, tasks, timeline, toolLabel } from "@/lib/chat";
import { defaultModel } from "@/lib/setup";
import { cn } from "@/lib/utils";
import type { TimelineItem } from "@/lib/chat";
import { useWorkspace } from "@/hooks/workspace";
import { useChatContext } from "@/hooks/chat-context";
import { useLocalSetting } from "@/hooks/useChat";
import { StatusLine } from "@/components/ui/status-orb";
import { Orb } from "@/components/ui/thinking-orbs";
import { Select } from "@/components/ui/input";
import { ToolGroup } from "@/components/tool-group";
import { ToolInvocation, ToolInvocationContentCollapsible, ToolInvocationName, ToolInvocationRawData } from "@/components/ui/tool-invocation";
import { TaskCard } from "@/components/task-card";
import { Markdown } from "@/components/markdown";

/** The chat surface: bubbles, plain assistant text, tool calls inline, one composer. */
export function Buyer({ onOpenAccount }: { onOpenAccount: () => void }) {
  const { status, setup, busy } = useWorkspace();
  const { runs, loaded, refresh, conversation } = useChatContext();
  const [model, setModel] = useLocalSetting("atm-chat-model", "");
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const names = useMemo(() => (status?.machine?.models ?? []).map((m) => m.name), [status]);
  const selectedModel = defaultModel(names, model);
  const thread = useMemo(() => runs.filter((r) => conversationOf(r) === conversation), [runs, conversation]);
  const active = thread.some((r) => ACTIVE_RUN.has(r.status));
  const ready = setup.canSend && selectedModel !== "";
  const canSend = ready && !sending && !busy && !active && prompt.trim().length > 0;

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    setSending(true); setError(undefined);
    try { await api.send({ prompt: prompt.trim(), model: selectedModel, conversation_id: conversation }); setPrompt(""); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "The request could not finish."); }
    finally { setSending(false); }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } };
  const stop = async (id: string) => { try { await api.stopRun(id); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Could not stop."); } };

  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = box.current; if (!el) return; el.style.height = "0px"; el.style.height = `${Math.min(el.scrollHeight, 180)}px`; }, [prompt]);
  useEffect(() => { setPrompt(""); setError(undefined); box.current?.focus(); }, [conversation]);

  const scroller = useRef<HTMLDivElement>(null);
  const signature = thread.map((r) => `${r.id}:${r.status}:${r.events.length}`).join("|");
  useEffect(() => { const el = scroller.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); }, [signature, conversation]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-5 pb-8 pt-8">
          {thread.length === 0
            ? <div className="flex min-h-[55vh] items-center justify-center"><h1 className="text-[24px] font-semibold tracking-[-0.02em] text-foreground/90 animate-fade-up">{loaded || !setup.chatLinked ? "What would you like to get done?" : ""}</h1></div>
            : <div className="flex flex-col gap-9">{thread.map((run) => <RunView key={run.id} run={run} onStop={() => void stop(run.id)} />)}</div>}
        </div>
      </div>

      <div className="px-5 pb-4">
        <div className="mx-auto w-full max-w-[760px]">
          {!ready && (
            <p className="mb-2 text-center text-[12.5px] text-muted-foreground">
              {selectedModel === "" && setup.chatLinked && setup.buyingReady ? "Install a local Ollama model to chat." : setup.chatNotice}{" "}
              <button className="underline underline-offset-2 hover:text-foreground" onClick={onOpenAccount}>Account</button>
            </p>
          )}
          {error && <p className="mb-2 text-center text-[12.5px] text-danger" role="alert">{error}</p>}
          <form onSubmit={(e) => void send(e)} className="flex flex-col rounded-[26px] border border-border bg-card px-4 pb-2 pt-2.5 shadow-card transition-colors focus-within:border-ring">
            <textarea ref={box} rows={1} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={onKey} maxLength={12000}
              placeholder={ready ? (active ? "Your agent is working…" : "Ask your agent") : "Finish setup to chat"} disabled={!ready || active}
              aria-label="Message your agent" className="scroll-thin max-h-[180px] min-h-[24px] w-full resize-none bg-transparent px-1 py-1.5 text-[15px] leading-6 outline-none placeholder:text-muted-foreground/70 disabled:opacity-60" />
            <div className="flex items-center gap-2 pt-1">
              <Select aria-label="Local model" className="w-auto min-w-[150px] max-w-[260px] text-muted-foreground [&>select]:h-8 [&>select]:border-0 [&>select]:bg-transparent [&>select]:text-[12.5px] [&>select]:shadow-none" value={selectedModel} disabled={!names.length} onChange={(e) => setModel(e.target.value)}>
                {names.length ? names.map((n) => <option key={n} value={n}>{n}</option>) : <option value="">No local models</option>}
              </Select>
              <button type="submit" disabled={!canSend} aria-label="Send"
                className="ml-auto grid size-9 shrink-0 place-items-center rounded-full bg-chat-accent text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30">
                <ArrowUp className="size-4.5" strokeWidth={2.5} aria-hidden />
              </button>
            </div>
          </form>
          <p className="mt-2.5 text-center text-[11px] text-muted-foreground">Delegated work passes a format check, not a correctness check. Payments are Stripe TEST mode.</p>
        </div>
      </div>
    </div>
  );
}

function RunView({ run, onStop }: { run: Run; onStop: () => void }) {
  const items = useMemo(() => timeline(run), [run]);
  const cards = useMemo(() => tasks(run), [run]);
  const live = ACTIVE_RUN.has(run.status);
  const last = items.at(-1);
  const lastStreaming = last?.kind === "assistant" && last.streaming;
  const transcript = items.filter((i) => i.kind === "assistant" && !i.streaming).map((i) => (i as { content: string }).content).filter(Boolean).join("\n\n");
  const cardsInline = items.some((i) => i.kind === "results");
  const cardGrid = cards.length > 0
    ? <ToolGroup summary={`Delegated ${cards.length} network task${cards.length === 1 ? "" : "s"}`} running={ACTIVE_RUN.has(run.status) && cards.some((c) => !["APPROVED", "REJECTED", "EXPIRED", "CANCELLED"].includes(c.status))}>{cards.map((t) => <TaskCard key={t.task_id} task={t} className="max-w-none rounded-none border-0 bg-transparent" />)}</ToolGroup>
    : null;
  // Fold consecutive tool calls into one block so the thread reads as prose.
  // Anything the model said before results came back is interim; once it answers again
  // after them, those earlier messages fold to two muted lines so the final answer reads last.
  const resultsAt = items.findIndex((i) => i.kind === "results");
  const answeredAfter = resultsAt >= 0 && items.slice(resultsAt + 1).some((i) => i.kind === "assistant" && !i.streaming && i.content.trim());
  const interim = new Set(answeredAfter ? items.slice(0, resultsAt).filter((i) => i.kind === "assistant").map((i) => i.key) : []);
  const blocks = useMemo(() => {
    const out: Array<TimelineItem | { kind: "tools"; key: string; tools: Extract<TimelineItem, { kind: "tool" }>[] }> = [];
    for (const item of items) {
      if (item.kind === "task" || item.kind === "note") continue; // status rows are covered by the task block
      const last = out.at(-1);
      if (item.kind === "tool") { if (last?.kind === "tools") last.tools.push(item); else out.push({ kind: "tools", key: item.key, tools: [item] }); }
      else out.push(item);
    }
    return out;
  }, [items]);
  return (
    <section aria-label="Request" className="flex flex-col gap-5">
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-xl bg-user-bubble px-4 py-2.5 text-[15px] leading-6 text-user-bubble-foreground">{run.prompt}</div>
      </div>
      <div className="flex flex-col gap-3 text-[15px] leading-[1.7]">
        {blocks.map((item) => {
          if (item.kind === "assistant") return (
            <div key={item.key} className="flex flex-col gap-2">
              {item.thinking && <Reasoning text={item.thinking} streaming={item.streaming && !item.content} />}
              {item.content && (item.streaming
                ? <p className="whitespace-pre-wrap break-words">{item.content}<span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-foreground" aria-hidden /></p>
                : interim.has(item.key) ? <Interim text={item.content} />
                : <Markdown text={item.content} className="break-words" />)}
            </div>
          );
          if (item.kind === "tools") {
            const running = item.tools.filter((t) => t.state === "input-available" || t.state === "input-streaming").length;
            const failed = item.tools.filter((t) => t.state === "output-error").length;
            const summary = `${running ? "Using" : "Used"} ${item.tools.length} tool${item.tools.length === 1 ? "" : "s"}${failed ? ` · ${failed} failed` : ""}`;
            return (
              <ToolGroup key={item.key} summary={summary} running={running > 0} defaultOpen={running > 0}>
                {item.tools.map((tool) => (
                  <ToolInvocation key={tool.key} className="rounded-none border-0 bg-transparent">
                    <ToolInvocationContentCollapsible header={<ToolInvocationName name={tool.name} label={toolLabel(tool.name)} type={tool.state} />}>
                      <ToolInvocationRawData data={tool.args} title="Arguments" />
                      <ToolInvocationRawData data={tool.result} title="Result" />
                    </ToolInvocationContentCollapsible>
                  </ToolInvocation>
                ))}
              </ToolGroup>
            );
          }
          if (item.kind === "results") return <div key={item.key}>{cardGrid}</div>;
          return null;
        })}
        {live && !lastStreaming && <StatusLine state={run.status === "waiting" ? "waiting" : "working"} label={run.status === "waiting" ? "Waiting for network workers" : "Working"} />}
        {!cardsInline && cardGrid}
        {run.error && <p className={cn("text-[13px]", run.status === "failed" ? "text-danger" : "text-muted-foreground")}>{run.error}</p>}
        <div className="flex items-center gap-1 text-muted-foreground">
          {live
            ? <button onClick={onStop} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] hover:bg-accent hover:text-foreground"><Square className="size-3" aria-hidden />Stop</button>
            : transcript && <CopyButton text={transcript} />}
        </div>
      </div>
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ } };
  return (
    <button onClick={() => void copy()} aria-label="Copy response" title="Copy" className="grid size-7 place-items-center rounded-md hover:bg-accent hover:text-foreground">
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}

/** Model reasoning streams inline as quiet text beside a reasoning orb; finished, it folds to two lines. */
function Reasoning({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex gap-2.5 text-[13.5px] leading-relaxed text-muted-foreground">
      <Orb state="reasoning" paused={!streaming} className="mt-[3px] shrink-0" />
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open || streaming}
        className={cn("min-w-0 text-left whitespace-pre-wrap break-words hover:text-foreground/80", !streaming && !open && "line-clamp-2")}>
        {text}{streaming && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-muted-foreground" aria-hidden />}
      </button>
    </div>
  );
}

/** A message written before network results arrived: kept, but folded under the final answer. */
function Interim({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
      className={cn("w-full text-left text-[13.5px] leading-relaxed text-muted-foreground hover:text-foreground/80", !open && "line-clamp-2")}>
      {open ? <Markdown text={text} /> : text}
    </button>
  );
}
