import { cn } from "@/lib/utils";
import { BrandOrb } from "./brand-orb";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-8 shrink-0 place-items-center text-foreground", className)} aria-hidden>
      <BrandOrb className="size-full" />
    </span>
  );
}

export function Brand({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <BrandMark />
      {!compact && (
        <span className="leading-tight">
          <span className="block text-[13px] font-semibold tracking-[0.08em]">HANDOFF</span>
          <span className="block text-[11px] text-muted-foreground">Local workspace</span>
        </span>
      )}
    </div>
  );
}
