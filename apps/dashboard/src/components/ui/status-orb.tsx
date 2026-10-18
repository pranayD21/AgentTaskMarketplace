import { Orb, type OrbLook } from "./thinking-orbs";
import { cn } from "@/lib/utils";

export type { OrbLook };

/** An orb and a short label for what the agent is doing right now. */
export function StatusLine({ label, state = "working", className }: { label: string; state?: OrbLook["state"]; className?: string }) {
  return (
    <div role="status" className={cn("inline-flex items-center gap-2.5 text-[14px] text-muted-foreground", className)}>
      <Orb {...({ state } as OrbLook)} label={label} /><span>{label}</span>
    </div>
  );
}
