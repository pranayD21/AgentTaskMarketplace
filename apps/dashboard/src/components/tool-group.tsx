import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger, useCollapsible } from "@/components/ui/collapsible";
import { Orb } from "@/components/ui/thinking-orbs";
import { cn } from "@/lib/utils";

function Chevron() {
  const ctx = useCollapsible();
  return <ChevronRight className={cn("size-4 transition-transform", ctx?.open && "rotate-90")} aria-hidden />;
}

/** A run of tool calls folded into one line, like "Used 3 tools ›". While one runs, an orb works beside it. */
export function ToolGroup({ summary, running = false, children, defaultOpen = false, className }:
  { summary: string; running?: boolean; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  return (
    <Collapsible defaultOpen={defaultOpen} className={cn("max-w-[600px]", className)}>
      <CollapsibleTrigger className="inline-flex w-auto items-center gap-2 text-[14px] text-muted-foreground hover:text-foreground">
        {running && <Orb state="working" />}{summary}<Chevron />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/60">{children}</CollapsibleContent>
    </Collapsible>
  );
}
