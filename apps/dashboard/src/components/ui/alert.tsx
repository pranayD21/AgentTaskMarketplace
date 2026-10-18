import type { HTMLAttributes } from "react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const tones = {
  info: { className: "border-info/30 bg-info-soft text-info", Icon: Info },
  warning: { className: "border-warning/40 bg-warning-soft text-foreground", Icon: TriangleAlert },
  danger: { className: "border-danger/30 bg-danger-soft text-danger", Icon: CircleAlert },
} as const;

export function Alert({ tone = "info", className, children, ...props }: HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof tones }) {
  const { className: toneClass, Icon } = tones[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed", toneClass, className)} {...props}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
