import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded font-medium transition-colors duration-fast disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-on hover:bg-accent-hover",
        secondary: "bg-surface-sunken text-text hover:bg-border",
        outline: "border border-border-strong bg-surface text-text hover:bg-surface-sunken",
        ghost: "text-text hover:bg-surface-sunken",
        danger: "bg-danger text-text-inverse hover:opacity-90",
        link: "text-accent-text underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 px-2 text-xs",
        md: "h-control px-3 text-sm",
        lg: "h-10 px-4 text-md",
        icon: "h-control w-control",
        iconSm: "h-7 w-7",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, type, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} type={asChild ? undefined : (type ?? "button")} {...props} />;
});
Button.displayName = "Button";

export { buttonVariants };
