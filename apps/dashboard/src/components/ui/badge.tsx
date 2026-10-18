import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const tones = {
  default: "bg-muted text-foreground",
  outline: "border border-border text-muted-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  muted: "bg-muted text-muted-foreground",
} as const;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> { tone?: keyof typeof tones; dot?: boolean }

export const Badge = ({ className, tone = "default", dot = false, children, ...props }: BadgeProps) => (
  <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium tracking-wide whitespace-nowrap", tones[tone], className)} {...props}>
    {dot && <i className="size-1.5 rounded-full bg-current" aria-hidden />}
    {children}
  </span>
);
