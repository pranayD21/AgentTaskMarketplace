import type { HTMLAttributes, ReactNode } from "react";
import { Check, ChevronRight, CircleAlert, Loader2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger, useCollapsible } from "./collapsible";

export type ToolInvocationType = "input-streaming" | "input-available" | "output-available" | "output-error";

export const ToolInvocation = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("rounded-xl border border-border bg-card/60 text-[13px]", className)} {...props} />
);

export const ToolInvocationHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex items-center gap-2 px-3 py-2", className)} {...props} />
);

const status: Record<ToolInvocationType, { icon: ReactNode; text: string; tone: string }> = {
  "input-streaming": { icon: <Loader2 className="size-3.5 animate-spin" />, text: "Preparing", tone: "text-muted-foreground" },
  "input-available": { icon: <Loader2 className="size-3.5 animate-spin" />, text: "Running", tone: "text-info" },
  "output-available": { icon: <Check className="size-3.5" />, text: "Done", tone: "text-success" },
  "output-error": { icon: <CircleAlert className="size-3.5" />, text: "Error", tone: "text-danger" },
};

export function ToolInvocationName({ name, type, label, className }: { name: string; type: ToolInvocationType; label?: string; className?: string }) {
  const s = status[type];
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-2", className)}>
      <span className="grid size-6 shrink-0 place-items-center rounded-md border border-border bg-card text-muted-foreground"><Wrench className="size-3.5" aria-hidden /></span>
      <span className="truncate font-medium">{label ?? name}</span>
      {label && <code className="hidden truncate text-[11px] text-muted-foreground sm:inline">{name}</code>}
      <span className={cn("ml-auto inline-flex items-center gap-1 text-[11.5px] font-medium", s.tone)}>{s.icon}{s.text}</span>
    </div>
  );
}

function Chevron() {
  const ctx = useCollapsible();
  return <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", ctx?.open && "rotate-90")} aria-hidden />;
}

/** Collapsible body. Wrap the header inside so the whole row toggles. */
export function ToolInvocationContentCollapsible({ defaultOpen = false, header, children, className }:
  { defaultOpen?: boolean; header?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <Collapsible defaultOpen={defaultOpen} className={className}>
      {header && (
        <CollapsibleTrigger className="group flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-accent/60">
          <Chevron />
          <div className="min-w-0 flex-1">{header}</div>
        </CollapsibleTrigger>
      )}
      <CollapsibleContent className="space-y-2 border-t border-border px-3 py-2.5">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function ToolInvocationRawData({ data, title, className }: { data: unknown; title: string; className?: string }) {
  if (data === undefined || data === null) return null;
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</div>
      <pre className="scroll-thin max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-card p-2.5 text-[12px] leading-relaxed text-foreground/90">{text}</pre>
    </div>
  );
}
