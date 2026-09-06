import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { underline?: boolean }
>(({ className, underline, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    data-underline={underline || undefined}
    className={cn(underline ? "flex max-w-full items-end gap-5 border-b border-border text-text-muted" : "inline-flex min-h-9 max-w-full flex-wrap items-center gap-1 rounded-md bg-surface-sunken p-1 text-text-muted", className)}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-3 py-1 text-sm font-medium transition-colors duration-fast disabled:opacity-50",
      "data-[state=active]:bg-surface data-[state=active]:text-text data-[state=active]:shadow-1",
      // the underlined form (the reason screen): the active tab carries an accent underline, nothing else
      "[[data-underline]_&]:-mb-px [[data-underline]_&]:rounded-none [[data-underline]_&]:border-b-2 [[data-underline]_&]:border-transparent [[data-underline]_&]:px-1 [[data-underline]_&]:py-2 [[data-underline]_&]:data-[state=active]:border-accent [[data-underline]_&]:data-[state=active]:bg-transparent [[data-underline]_&]:data-[state=active]:text-accent-text [[data-underline]_&]:data-[state=active]:shadow-none",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => <TabsPrimitive.Content ref={ref} className={cn("mt-3 outline-none", className)} {...props} />);
TabsContent.displayName = "TabsContent";
