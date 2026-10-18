import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Animated "working" text. Respects prefers-reduced-motion via the base layer. */
export function ShimmerText({ className, children, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("shimmer-text font-medium", className)} {...props}>{children}</span>;
}

export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-hidden>
      {[0, 1, 2].map((i) => <i key={i} className="size-1.5 rounded-full bg-muted-foreground animate-dot" style={{ animationDelay: `${i * 0.16}s` }} />)}
    </span>
  );
}

export function Thinking({ label = "Thinking", className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn("inline-flex items-center gap-2 text-[13px]", className)}>
      <TypingDots /><ShimmerText>{label}…</ShimmerText>
    </div>
  );
}
