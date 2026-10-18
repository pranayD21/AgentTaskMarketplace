import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "./card";

export function Stat({ label, value, hint, className, children }: { label: string; value: ReactNode; hint?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <Card className={cn("flex flex-col gap-1 p-4", className)}>
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
      <strong className="truncate text-[20px] font-semibold tracking-[-0.02em] leading-tight">{value}</strong>
      {hint && <span className="truncate text-[12px] text-muted-foreground">{hint}</span>}
      {children}
    </Card>
  );
}
