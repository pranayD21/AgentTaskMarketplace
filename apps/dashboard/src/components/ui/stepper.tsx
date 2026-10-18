import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepProps {
  index: number; title: string; detail: string; done: boolean; current?: boolean; action?: ReactNode; last?: boolean;
}

export function Step({ index, title, detail, done, current, action, last }: StepProps) {
  return (
    <li className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-full border text-[12px] font-semibold transition-colors",
          done ? "border-success bg-success text-white" : current ? "border-foreground bg-card text-foreground" : "border-border bg-card text-muted-foreground")}>
          {done ? <Check className="size-3.5" aria-hidden /> : index}
        </span>
        {!last && <span className={cn("mt-1 w-px flex-1", done ? "bg-success/60" : "bg-border")} aria-hidden />}
      </div>
      <div className={cn("flex min-w-0 flex-1 flex-col gap-3 pb-6 sm:flex-row sm:items-start sm:justify-between", last && "pb-0")}>
        <div className="min-w-0">
          <h3 className={cn("text-[14px] font-semibold leading-tight", !done && !current && "text-muted-foreground")}>{title}</h3>
          <p className="mt-1 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">{detail}</p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </li>
  );
}

export const Steps = ({ children, className }: { children: ReactNode; className?: string }) => <ol className={cn("flex flex-col", className)}>{children}</ol>;
