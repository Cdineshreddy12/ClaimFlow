import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * A status chip.
 *
 * Status is encoded twice — by the dot and by the fill — never by
 * colour alone, because roughly one desk executive in twelve won't
 * separate the green from the rust reliably. The dot is a real element
 * rather than a `::before` so it inherits the variant's colour through
 * `currentColor` without a second rule per variant.
 *
 * Semantic colours are kept out of the accent's way on purpose: the
 * accent means "this is interactive", these mean "this is the state".
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-xs px-2.5 py-[3px] text-sm font-semibold tracking-[0.01em]",
  {
    variants: {
      variant: {
        approved: "bg-approved-bg text-approved",
        pending: "bg-pending-bg text-pending",
        critical: "bg-critical-bg text-critical",
        neutral: "bg-neutral-bg text-neutral",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Drops the status dot, for a count rather than a state. */
  dot?: boolean;
}

export function Badge({
  className,
  variant,
  dot = true,
  children,
  ...props
}: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-current"
        />
      ) : null}
      {children}
    </span>
  );
}

/**
 * The pill that carries a count beside a tab label — "3 missing",
 * "0 of 24". A number a desk acts on, so it takes a tone.
 */
const countBadgeVariants = cva(
  "rounded-[10px] px-[7px] py-0.5 text-2xs font-semibold",
  {
    variants: {
      tone: {
        neutral: "bg-neutral-bg text-neutral",
        pending: "bg-pending-bg text-pending",
        critical: "bg-critical-bg text-critical",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function CountBadge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof countBadgeVariants>) {
  return (
    <span className={cn(countBadgeVariants({ tone }), className)} {...props} />
  );
}
