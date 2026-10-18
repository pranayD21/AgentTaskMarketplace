import { createContext, useContext, useId, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const Ctx = createContext<{ open: boolean; toggle: () => void; id: string } | null>(null);

export function Collapsible({ defaultOpen = false, open, onOpenChange, className, children, ...props }:
  HTMLAttributes<HTMLDivElement> & { defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode }) {
  const [internal, setInternal] = useState(defaultOpen);
  const isOpen = open ?? internal;
  const id = useId();
  const toggle = () => { setInternal(!isOpen); onOpenChange?.(!isOpen); };
  return <Ctx.Provider value={{ open: isOpen, toggle, id }}><div data-state={isOpen ? "open" : "closed"} className={className} {...props}>{children}</div></Ctx.Provider>;
}

export function CollapsibleTrigger({ className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const ctx = useContext(Ctx)!;
  return <button type="button" aria-expanded={ctx.open} aria-controls={ctx.id} onClick={ctx.toggle} className={cn("w-full text-left", className)} {...props}>{children}</button>;
}

export function CollapsibleContent({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const ctx = useContext(Ctx)!;
  if (!ctx.open) return null;
  return <div id={ctx.id} className={cn("animate-fade-up", className)} {...props}>{children}</div>;
}

export const useCollapsible = () => useContext(Ctx);
