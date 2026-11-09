import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { cn } from "@/lib/utils";

/**
 * A tick box.
 *
 * Radix rather than a bare `<input type="checkbox">` because the
 * native control can't be styled to match the rest of the form — it
 * renders in the platform's own colours and sizes, which is why the
 * old one looked like a stray OS widget next to the shadcn inputs.
 */
export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer size-4 shrink-0 rounded-[4px] border border-line-strong bg-surface-raised",
      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
      "disabled:cursor-not-allowed disabled:opacity-50",
      // Filled with navy, like the primary button: the accent is
      // reserved for links, the active nav item and charts.
      "data-[state=checked]:border-transparent data-[state=checked]:bg-primary data-[state=checked]:text-white",
      "aria-[invalid=true]:border-critical",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      {/* Inline rather than from the icon set: it has to scale with the
          box, and at 16px a stroked tick from the sidebar's icons is
          heavier than the border it sits inside. */}
      <svg
        viewBox="0 0 16 16"
        fill="none"
        className="size-3.5"
        aria-hidden="true"
      >
        <path
          d="M3.5 8.5l3 3 6-6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";
