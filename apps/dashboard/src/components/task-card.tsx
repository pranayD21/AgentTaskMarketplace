import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { TaskView } from "@/lib/chat";
import { cn } from "@/lib/utils";
import { ToolInvocation, ToolInvocationContentCollapsible, ToolInvocationName, ToolInvocationRawData, type ToolInvocationType } from "@/components/ui/tool-invocation";
import { Markdown } from "@/components/markdown";

const state = (status: string): ToolInvocationType =>
  status === "APPROVED" ? "output-available" : ["REJECTED", "EXPIRED", "CANCELLED"].includes(status) ? "output-error" : "input-available";

/** A delegated network task, shown like a tool call: one collapsed row, details on demand. */
export function TaskCard({ task, showViewerLink = true, defaultOpen = false, className }: { task: TaskView; showViewerLink?: boolean; defaultOpen?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(task.answer ?? ""); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };
  const pending = ["SUBMITTED", "JUDGING", "APPROVED", "REJECTED"].includes(task.status) && !task.answer;
  return (
    <ToolInvocation className={cn("max-w-[560px]", className)} aria-label={`Task ${task.index + 1}`}>
      <ToolInvocationContentCollapsible defaultOpen={defaultOpen}
        header={<ToolInvocationName name={task.task_id} label={`Task ${task.index + 1} · ${task.label}`} type={state(task.status)} />}>
        <p className="break-all font-mono text-[11px] text-muted-foreground">
          {task.task_id}{task.seller_id ? ` · worker ${task.seller_id}` : ""}{task.model_id ? ` · ${task.model_id}` : ""}
        </p>
        {task.prompt && <ToolInvocationRawData data={task.prompt} title="Worker task prompt" />}
        <div className="min-w-0">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{task.approved ? "Final output" : "Submitted output"}</div>
          {task.answer ? <Markdown text={task.answer} className="rounded-md border border-border bg-card p-2.5 text-[12px] leading-relaxed text-foreground/90" />
            : <p className="text-[12px] text-muted-foreground">{pending ? "Retrieving the worker’s output…" : "No output yet. This updates automatically."}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          <span className="min-w-0 flex-1">
            {task.approved ? "Completion-format check passed. This does not verify answer correctness."
              : task.status === "REJECTED" ? "This output failed review; it is not an approved result."
              : task.answer ? "Awaiting review. This is the worker’s submitted output, not an approved result."
              : "The worker submits its output when inference finishes."}
          </span>
          {task.answer && <button onClick={() => void copy()} className="inline-flex items-center gap-1 hover:text-foreground">{copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}{copied ? "Copied" : "Copy"}</button>}
          {showViewerLink && <a className="inline-flex items-center gap-1 hover:text-foreground" href={`/task.html?task=${encodeURIComponent(task.task_id)}`} target="_blank" rel="noopener">Viewer<ExternalLink className="size-3" aria-hidden /></a>}
        </div>
      </ToolInvocationContentCollapsible>
    </ToolInvocation>
  );
}
