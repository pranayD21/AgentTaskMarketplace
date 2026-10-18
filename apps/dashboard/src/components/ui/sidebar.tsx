import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Sidebar = ({ className, ...props }: HTMLAttributes<HTMLElement>) => (
  <aside className={cn("flex h-full w-[232px] shrink-0 flex-col border-r border-border bg-card/70 backdrop-blur", className)} {...props} />
);
export const SidebarHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("px-4 pb-3 pt-5", className)} {...props} />
);
export const SidebarGroupLabel = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("px-3 pb-1.5 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground", className)} {...props} />
);
export const SidebarNav = ({ className, ...props }: HTMLAttributes<HTMLElement>) => (
  <nav className={cn("flex flex-col gap-0.5 px-2", className)} {...props} />
);
export function SidebarNavItem({ active, icon, children, badge, className, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; icon?: ReactNode; badge?: ReactNode }) {
  return (
    <button type="button" aria-current={active ? "page" : undefined}
      className={cn("flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground", className)} {...props}>
      {icon && <span className="grid size-4 place-items-center" aria-hidden>{icon}</span>}
      <span className="truncate">{children}</span>
      {badge && <span className="ml-auto">{badge}</span>}
    </button>
  );
}
export const SidebarFooter = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("mt-auto border-t border-border p-3", className)} {...props} />
);
