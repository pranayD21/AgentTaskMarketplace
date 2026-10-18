import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Table = ({ className, ...props }: HTMLAttributes<HTMLTableElement>) => (
  <div className="scroll-thin w-full overflow-auto"><table className={cn("w-full text-[13px]", className)} {...props} /></div>
);
export const TH = ({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn("h-9 border-b border-border px-5 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground", className)} {...props} />
);
export const TD = ({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("border-b border-border/70 px-5 py-3 align-middle", className)} {...props} />
);
