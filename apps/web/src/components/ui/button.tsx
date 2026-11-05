import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Button variants matched to the b2b-crm's toolbar.
 *
 * Two things worth knowing. The solid button is the CRM's near-black
 * navy `--primary`, not the deep blue accent: the CRM reserves the
 * accent for links, the active nav item, chart bars and sort carets, so
 * the one filled control on a screen never competes with them. And
 * `outline` is the workhorse — "More actions", "Filters", "Density" and
 * the icon buttons are all white with a hairline border, which is what
 * lets a single navy button read as the page's primary action.
 *
 * Icons go in as children; `[&_svg]` sizes them so call sites don't
 * each pick a number.
 */
const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-2 rounded-md border font-medium",
    "transition-colors cursor-pointer whitespace-nowrap select-none",
    "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:pointer-events-none",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    "disabled:cursor-not-allowed disabled:opacity-45",
  ),
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-white border-transparent hover:bg-primary-hover",
        outline:
          "bg-surface-raised text-ink border-line hover:bg-hover hover:border-line-strong",
        danger:
          "bg-transparent text-critical border-current hover:bg-critical-bg",
      },
      size: {
        default: "h-9 px-3.5 text-base",
        sm: "h-8 px-2.5 text-sm",
        // Square, for the refresh / settings controls in a toolbar.
        icon: "h-9 w-9 px-0",
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
