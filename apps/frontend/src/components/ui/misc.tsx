import * as React from "react";
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import { cn } from "@/lib/utils";

export const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = "horizontal", decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn("shrink-0 bg-border", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)}
    {...props}
  />
));
Separator.displayName = "Separator";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("surface card-pad shadow-1", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("mb-3 text-base font-semibold text-text", className)} {...props} />;
}

export function Progress({ value, className, label }: { value: number; className?: string; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label} className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken", className)}>
      <div className="h-full bg-accent transition-[width] duration-base" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("animate-pulse rounded bg-surface-sunken", className)} {...props} />;
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border-strong bg-surface-sunken px-1 font-mono text-[11px] text-text-muted", className)}>{children}</kbd>;
}

export function VisuallyHidden({ children }: { children: React.ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

export function Alert({ level = "info", title, children, className, actions }: { level?: "info" | "warn" | "fail" | "success"; title?: string; children?: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  const styles = {
    info: "border-info/40 bg-info-subtle text-info",
    warn: "border-warning/40 bg-warning-subtle text-warning",
    fail: "border-danger/40 bg-danger-subtle text-danger",
    success: "border-success/40 bg-success-subtle text-success",
  }[level];
  const glyph = { info: "i", warn: "!", fail: "✕", success: "✓" }[level];
  return (
    <div role={level === "fail" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-md border px-3 py-2 text-sm", styles, className)}>
      <span aria-hidden className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-current font-mono text-xs font-semibold">
        {glyph}
      </span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-text">{children}</div>}
      </div>
      {actions}
    </div>
  );
}

export const Table = React.forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(({ className, ...props }, ref) => (
  <div className="w-full overflow-x-auto">
    <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
  </div>
));
Table.displayName = "Table";
export const Th = ({ className, numeric, ...props }: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) => (
  <th scope="col" className={cn("h-8 whitespace-nowrap border-b border-border px-2 text-left text-xs font-medium text-text-muted", numeric && "text-right", className)} {...props} />
);
export const Td = ({ className, numeric, ...props }: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) => (
  <td className={cn("border-b border-border px-2 py-1.5 align-top", numeric && "tnum text-right", className)} {...props} />
);
