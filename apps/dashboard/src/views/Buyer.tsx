import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, MessagesSquare, Plus, Square } from "lucide-react";
import { api, type Run } from "@/lib/api";
import { ACTIVE_RUN, conversationOf, runHeadline, tasks, timeline, toolLabel } from "@/lib/chat";
import { defaultModel } from "@/lib/setup";
import { cn, microusd } from "@/lib/utils";
import { useWorkspace } from "@/hooks/workspace";
import { newId, useChat, useLocalSetting } from "@/hooks/useChat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { ChatMessage, ChatMessageAvatar, ChatMessageContent } from "@/components/ui/chat-message";
import { Thinking } from "@/components/ui/shimmer";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ToolInvocation, ToolInvocationContentCollapsible, ToolInvocationName, ToolInvocationRawData } from "@/components/ui/tool-invocation";
import { TaskCard } from "@/components/task-card";

export function Buyer({ onOpenAccount }: { onOpenAccount: () => void }) {
  const { status, setup, busy } = useWorkspace();
  const { runs, loaded, refresh } = useChat(setup.chatLinked);
  const [conversation, setConversation] = useLocalSetting("atm-conversation", newId());
  const [model, setModel] = useLocalSetting("atm-chat-model", "");
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const names = useMemo(() => (status?.machine?.models ?? []).map((m) => m.name), [status]);
  const selectedModel = defaultModel(names, model);
  const conversations = useMemo(() => {
    const ids = [...new Set([conversation, ...runs.map(conversationOf)])];
    return ids.map((id) => ({ id, title: runs.find((r) => conversationOf(r) === id)?.prompt.slice(0, 60) || "New conversation" }));
  }, [runs, conversation]);
  const thread = useMemo(() => runs.filter((r) => conversationOf(r) === conversation), [runs, conversation]);
  const active = thread.some((r) => ACTIVE_RUN.has(r.status));
  const canSend = setup.canSend && !sending && !busy && !active && prompt.trim().length > 0 && selectedModel !== "";

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
  const newChat = () => { setConversation(newId()); setPrompt(""); };

  const scroller = useRef<HTMLDivElement>(null);
  const signature = thread.map((r) => `${r.id}:${r.status}:${r.events.length}`).join("|");
  useEffect(() => { const el = scroller.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); }, [signature, conversation]);

  const budget = microusd(status?.provider_budget?.remaining_microusd);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold tracking-[-0.01em]">Buyer</h1>
          <p className="truncate text-[12px] text-muted-foreground">
            {setup.chatLinked ? `${setup.email} · ${setup.buyingReady ? "payment ready" : "payment setup needed"}${budget ? ` · ${budget} shared allowance` : ""}` : "Your local model plans the work and can delegate independent parts to the network."}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Select aria-label="Conversation" className="w-[220px]" value={conversation} onChange={(e) => setConversation(e.target.value)}>
            {conversations.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </Select>
          <Button variant="secondary" size="sm" onClick={newChat}><Plus className="size-3.5" aria-hidden />New chat</Button>
        </div>
      </header>

      <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[820px] px-6 py-6">
          {!setup.chatLinked || !setup.buyingReady ? (
            <Alert tone="warning" className="mb-6">
              <span>{setup.chatNotice}</span>{" "}
              <button className="font-medium underline underline-offset-2" onClick={onOpenAccount}>Open account setup</button>
            </Alert>
          ) : null}
          {thread.length === 0 ? (
            <EmptyThread loaded={loaded || !setup.chatLinked} />
          ) : (
            <div className="flex flex-col gap-8">{thread.map((run) => <RunView key={run.id} run={run} onStop={() => void stop(run.id)} />)}</div>
          )}
        </div>
      </div>

      <form onSubmit={(e) => void send(e)} className="border-t border-border bg-background/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto w-full max-w-[820px]">
          {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
          <div className="rounded-xl border border-input bg-card shadow-card focus-within:border-ring">
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={onKey} rows={3} maxLength={12000}
              placeholder={setup.canSend ? "Describe a real task you need help with…" : setup.chatNotice}
              disabled={!setup.canSend || active} aria-label="Message your agent"
              className="min-h-[84px] border-0 bg-transparent px-4 pt-3 focus-visible:border-0" />
            <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
              <Select aria-label="Local model" className="w-[200px]" value={selectedModel} onChange={(e) => setModel(e.target.value)} disabled={!names.length}>
                {names.length ? names.map((n) => <option key={n} value={n}>{n}</option>) : <option value="">No local models</option>}
              </Select>
              <span className="hidden text-[11.5px] text-muted-foreground sm:inline">Up to 200 TEST cents per request · ⏎ to send</span>
              <Button type="submit" size="icon" className="ml-auto rounded-full" disabled={!canSend} loading={sending} aria-label="Send request">
                {!sending && <ArrowUp className="size-4" aria-hidden />}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

function EmptyThread({ loaded }: { loaded: boolean }) {
  return (
    <div className="flex min-h-[46vh] flex-col items-center justify-center text-center animate-fade-up">
      <span className="grid size-11 place-items-center rounded-xl border border-border bg-card text-muted-foreground shadow-card"><MessagesSquare className="size-5" aria-hidden /></span>
      <h2 className="mt-5 text-[22px] font-semibold tracking-[-0.02em]">What would you like to get done?</h2>
      <p className="mt-2 max-w-md text-[13.5px] text-muted-foreground">
        {loaded ? "Your local model answers directly or splits the work into independent tasks for network workers. Approved results come back here." : "Loading your conversations…"}
      </p>
    </div>
  );
}

function RunView({ run, onStop }: { run: Run; onStop: () => void }) {
  const items = useMemo(() => timeline(run), [run]);
  const cards = useMemo(() => tasks(run), [run]);
  const headline = runHeadline(run);
  const live = ACTIVE_RUN.has(run.status);
  const lastStreaming = items.at(-1)?.kind === "assistant" && (items.at(-1) as { streaming: boolean }).streaming;
  return (
    <section aria-label="Request" className="flex flex-col gap-4">
      <ChatMessage role="user"><ChatMessageAvatar role="user" /><ChatMessageContent role="user">{run.prompt}</ChatMessageContent></ChatMessage>
      {items.length > 0 && (
        <ChatMessage role="assistant">
          <ChatMessageAvatar role="assistant" />
          <div className="min-w-0 flex-1 space-y-3">
            {items.map((item) => {
              if (item.kind === "assistant") return (
                <div key={item.key} className="space-y-2">
                  {item.thinking && (
                    <Collapsible defaultOpen={item.streaming && !item.content} className="rounded-lg border border-border bg-subtle/60 text-[12.5px]">
                      <CollapsibleTrigger className="px-3 py-1.5 text-muted-foreground hover:text-foreground">{item.streaming && !item.content ? <Thinking label="Reasoning" /> : "Model reasoning"}</CollapsibleTrigger>
                      <CollapsibleContent className="border-t border-border px-3 py-2"><pre className="scroll-thin max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans leading-relaxed text-muted-foreground">{item.thinking}</pre></CollapsibleContent>
                    </Collapsible>
                  )}
                  {item.content && <ChatMessageContent role="assistant">{item.content}{item.streaming && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-foreground" aria-hidden />}</ChatMessageContent>}
                </div>
              );
              if (item.kind === "tool") return (
                <ToolInvocation key={item.key}>
                  <ToolInvocationContentCollapsible header={<ToolInvocationName name={item.name} label={toolLabel(item.name)} type={item.state} />}>
                    <ToolInvocationRawData data={item.args} title="Arguments" />
                    <ToolInvocationRawData data={item.result} title="Result" />
                  </ToolInvocationContentCollapsible>
                </ToolInvocation>
              );
              if (item.kind === "task") return (
                <div key={item.key} className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                  <Badge tone={item.task.status === "APPROVED" ? "success" : ["REJECTED", "EXPIRED", "CANCELLED"].includes(item.task.status) ? "danger" : "info"} dot>{item.task.status}</Badge>
                  <span className="truncate font-mono text-[11px]">{item.task.task_id}</span>
                  <span className="truncate">{item.task.seller_id ? `worker ${item.task.seller_id}` : "no worker yet"}</span>
                </div>
              );
              return <p key={item.key} className={cn("text-[12.5px]", item.tone === "warning" ? "text-warning" : "text-muted-foreground")}>{item.text}</p>;
            })}
            {live && !lastStreaming && <Thinking label={run.status === "waiting" ? "Waiting for network workers" : "Thinking"} />}
          </div>
        </ChatMessage>
      )}
      {items.length === 0 && live && <div className="pl-10"><Thinking /></div>}
      {cards.length > 0 && <div className="grid gap-3 pl-10">{cards.map((t) => <TaskCard key={t.task_id} task={t} />)}</div>}
      <footer className="flex items-center gap-3 pl-10 text-[12px] text-muted-foreground">
        <Badge tone={headline.tone} dot={live}>{headline.text}</Badge>
        {cards.length > 0 && <span>{cards.length} network task{cards.length === 1 ? "" : "s"}</span>}
        {run.model && <span className="font-mono text-[11px]">{run.model}</span>}
        {live && <Button variant="outline" size="sm" className="ml-auto h-7 gap-1.5 px-2.5 text-[12px]" onClick={onStop}><Square className="size-3" aria-hidden />Stop</Button>}
      </footer>
      {run.error && <Alert tone={run.status === "failed" ? "danger" : "warning"} className="ml-10">{run.error}</Alert>}
    </section>
  );
}
