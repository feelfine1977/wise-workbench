import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-medium leading-4 whitespace-nowrap", {
  variants: {
    variant: {
      default: "border-border bg-surface-sunken text-text",
      outline: "border-border-strong bg-transparent text-text-muted",
      info: "border-transparent bg-info-subtle text-info",
      success: "border-transparent bg-success-subtle text-success",
      warning: "border-transparent bg-warning-subtle text-warning",
      danger: "border-transparent bg-danger-subtle text-danger",
      accent: "border-transparent bg-accent-subtle text-accent-text",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
