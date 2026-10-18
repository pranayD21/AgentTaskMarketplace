import type { HTMLAttributes, ReactNode } from "react";
import { Sparkles, User } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChatRole = "user" | "assistant";

export function ChatMessage({ role, className, children, ...props }: HTMLAttributes<HTMLDivElement> & { role: ChatRole }) {
  return (
    <div data-role={role} className={cn("flex w-full gap-3 animate-fade-up", role === "user" ? "flex-row-reverse" : "flex-row", className)} {...props}>
      {children}
    </div>
  );
}

export function ChatMessageAvatar({ role, className }: { role: ChatRole; className?: string }) {
  return (
    <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-border",
      role === "user" ? "bg-card text-muted-foreground" : "bg-primary text-primary-foreground", className)} aria-hidden>
      {role === "user" ? <User className="size-3.5" /> : <Sparkles className="size-3.5" />}
    </span>
  );
}

export function ChatMessageContent({ role, label, children, className }: { role: ChatRole; label?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 max-w-[88%] space-y-1.5", role === "user" && "items-end text-right", className)}>
      {label && <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>}
      <div className={cn("inline-block max-w-full whitespace-pre-wrap break-words text-left text-[14px] leading-relaxed",
        role === "user" ? "rounded-2xl rounded-tr-md bg-user-bubble px-4 py-2.5" : "")}>{children}</div>
    </div>
  );
}
