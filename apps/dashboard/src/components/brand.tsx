import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground", className)} aria-hidden>
      <svg viewBox="0 0 32 32" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 23l7-13 7 13M12.5 17.5h7" />
      </svg>
    </span>
  );
}

export function Brand({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <BrandMark />
      {!compact && (
        <span className="leading-tight">
          <span className="block text-[13px] font-semibold tracking-[-0.01em]">Agent Task Marketplace</span>
          <span className="block text-[11px] text-muted-foreground">Local workspace</span>
        </span>
      )}
    </div>
  );
}
