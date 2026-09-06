import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type = "text", ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "flex h-control w-full rounded border border-border bg-surface px-3 text-sm text-text placeholder:text-text-subtle hover:border-border-strong disabled:opacity-50",
      type === "number" && "tnum",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn("flex min-h-[72px] w-full rounded border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-subtle hover:border-border-strong disabled:opacity-50", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";
