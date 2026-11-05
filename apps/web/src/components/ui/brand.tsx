import { cn } from "@/lib/utils";

/**
 * The product mark: a bordered square with two rules through it, a
 * ledger seen end-on.
 *
 * Drawn in `currentColor` rather than a fixed ink. It appears on the
 * dark sidebar and on the white auth and onboarding pages, and the
 * previous version hardcoded the sidebar's near-white ink — which made
 * it invisible on the two light pages.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative size-5 shrink-0 rounded-[3px] border-[1.5px] border-current",
        className,
      )}
    >
      <span className="absolute inset-x-[3px] top-1.5 h-[1.5px] bg-current shadow-[0_4px_0_currentColor]" />
    </span>
  );
}

export function BrandName({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "text-lg font-semibold tracking-[-0.01em] text-current",
        className,
      )}
    >
      Claims Desk
    </span>
  );
}
