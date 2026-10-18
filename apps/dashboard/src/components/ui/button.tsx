import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const variants = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-card",
  secondary: "bg-card text-foreground border border-border hover:bg-subtle shadow-card",
  outline: "border border-input bg-transparent hover:bg-accent",
  ghost: "hover:bg-accent text-foreground",
  destructive: "bg-danger text-white hover:bg-danger/90",
  link: "text-foreground underline underline-offset-4 hover:text-muted-foreground px-0 h-auto",
} as const;
const sizes = {
  default: "h-9 px-3.5 text-[13px]",
  sm: "h-8 px-3 text-[12.5px]",
  lg: "h-11 px-5 text-sm",
  icon: "h-9 w-9",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "default", size = "default", loading = false, disabled, children, type = "button", ...props }, ref) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading}
      className={cn("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-45", variants[variant], sizes[size], className)} {...props}>
      {loading && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
