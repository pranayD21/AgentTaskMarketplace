import { forwardRef, type InputHTMLAttributes, type LabelHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const field = "w-full rounded-lg border border-input bg-card px-3 text-[13.5px] placeholder:text-muted-foreground/70 transition-colors focus-visible:border-ring disabled:opacity-50 disabled:bg-subtle";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(field, "h-9", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(field, "min-h-20 py-2 leading-relaxed resize-none", className)} {...props} />;
});

export const Label = ({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={cn("block text-[12.5px] font-medium text-foreground/90", className)} {...props} />
);

/** Native select with a custom chevron: accessible and keyboard-complete without a popover library. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <span className={cn("relative inline-flex w-full", className)}>
      <select ref={ref} className={cn(field, "h-9 appearance-none pr-8 cursor-pointer")} {...props}>{children}</select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </span>
  );
});
