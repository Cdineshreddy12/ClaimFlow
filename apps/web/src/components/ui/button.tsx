import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-1.5 rounded-md border border-transparent font-semibold",
    "transition-colors cursor-pointer whitespace-nowrap",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    "disabled:cursor-not-allowed disabled:opacity-45",
  ),
  {
    variants: {
      variant: {
        primary: "bg-accent text-surface-raised hover:bg-accent-ink",
        ghost:
          "bg-transparent text-ink border-line-strong hover:bg-accent-soft",
        danger:
          "bg-transparent text-critical border-current hover:bg-critical-bg",
      },
      size: {
        default: "px-3.5 py-2 text-[13.5px]",
        sm: "px-2.5 py-1.5 text-[12.5px]",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
