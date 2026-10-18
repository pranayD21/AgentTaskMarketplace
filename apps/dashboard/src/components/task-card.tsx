import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { TaskView } from "@/lib/chat";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const tone = (status: string) =>
  status === "APPROVED" ? "success" : ["REJECTED", "EXPIRED", "CANCELLED"].includes(status) ? "danger"
  : ["SUBMITTED", "JUDGING"].includes(status) ? "info" : ["CLAIMED", "PAYLOAD_READY", "RUNNING"].includes(status) ? "warning" : "muted";

export function TaskCard({ task, showViewerLink = true, className }: { task: TaskView; showViewerLink?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(task.answer ?? ""); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* selection fallback */ }
  };
  const pending = ["SUBMITTED", "JUDGING", "APPROVED", "REJECTED"].includes(task.status) && !task.answer;
  return (
    <article className={cn("rounded-xl border border-border bg-card shadow-card", className)} aria-label={`Task ${task.index + 1}`}>
      <header className="flex flex-wrap items-center gap-2 px-4 pt-3.5">
        <span className="text-[13px] font-semibold">Task {task.index + 1}</span>
        <Badge tone={tone(task.status)} dot={["CLAIMED", "PAYLOAD_READY", "RUNNING", "SUBMITTED", "JUDGING"].includes(task.status)}>{task.label}</Badge>
        {showViewerLink && (
          <a className="ml-auto inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground" href={`/task.html?task=${encodeURIComponent(task.task_id)}`} target="_blank" rel="noopener">
            Task viewer<ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </header>
      <p className="mt-1 break-all px-4 font-mono text-[11px] text-muted-foreground">
        {task.task_id}{task.seller_id ? ` · worker ${task.seller_id}` : ""}{task.model_id ? ` · ${task.model_id}` : ""}
      </p>
      {task.prompt && (
        <Collapsible className="mx-4 mt-3 rounded-lg border border-border bg-subtle/60">
          <CollapsibleTrigger className="px-3 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground">Worker task prompt</CollapsibleTrigger>
          <CollapsibleContent className="border-t border-border px-3 py-2"><pre className="scroll-thin max-h-56 overflow-auto whitespace-pre-wrap break-words font-sans text-[12.5px] leading-relaxed">{task.prompt}</pre></CollapsibleContent>
        </Collapsible>
      )}
      <div className="px-4 pb-4 pt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{task.approved ? "Final output" : "Submitted output"}</span>
          {task.answer && <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[12px]" onClick={() => void copy()}>{copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? "Copied" : "Copy"}</Button>}
        </div>
        <pre className={cn("scroll-thin max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border p-3 font-sans text-[13.5px] leading-relaxed",
          task.answer ? "bg-background" : "bg-subtle text-muted-foreground")}>
          {task.answer ?? (pending ? "Retrieving the worker’s output…" : "No output yet. This updates automatically.")}
        </pre>
        <p className="mt-2 text-[12px] text-muted-foreground">
          {task.approved ? "Completion-format check passed. This does not verify answer correctness."
            : task.status === "REJECTED" ? "This output failed review; it is not an approved result."
            : task.answer ? "Awaiting review. This is the worker’s submitted output, not an approved result."
            : "The worker submits its output when inference finishes."}
        </p>
      </div>
    </article>
  );
}
