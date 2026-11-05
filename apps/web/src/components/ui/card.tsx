import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The surface every panel on the desk sits on.
 *
 * A card still reads as a surface sitting slightly above the page — the
 * border alone was too quiet to separate content from chrome at a
 * glance. The shadow is deliberately faint (the CRM's shadow-xs, a
 * single hairline) so the white ground stays flat and the border keeps
 * doing the structural work.
 *
 * `padded={false}` is for cards whose content runs edge to edge — a
 * table, mainly, where padding would leave the grid floating inside a
 * box instead of filling it.
 */
export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { padded?: boolean }
>(({ className, padded = true, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-lg border border-line bg-surface-raised shadow-card",
      padded ? "px-[18px] py-4" : "overflow-hidden",
      className,
    )}
    {...props}
  />
));
Card.displayName = "Card";

/**
 * Title on the left, whatever acts on the card on the right.
 *
 * Baseline-aligned rather than centred: the title and a small action
 * beside it have different heights, and aligning their boxes leaves the
 * text looking off by a pixel or two.
 */
export const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "mb-3.5 flex items-baseline justify-between gap-2.5",
      className,
    )}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

/**
 * The small uppercase label a card is titled with.
 *
 * Renders an h2 by default so a screen reader gets the outline; pass
 * `as` where the heading level would be wrong.
 */
export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement> & { as?: "h1" | "h2" | "h3" }
>(({ className, as: Comp = "h2", ...props }, ref) => (
  <Comp
    ref={ref}
    className={cn(
      "m-0 text-2xs font-semibold uppercase tracking-[0.07em] text-ink-faint",
      className,
    )}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

export const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("min-w-0", className)} {...props} />
));
CardContent.displayName = "CardContent";
