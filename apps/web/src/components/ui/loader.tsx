import { cn } from "@/lib/utils";

const SIZE = {
  sm: "h-3.5 w-3.5 border-[1.5px]",
  default: "h-4 w-4 border-2",
  lg: "h-6 w-6 border-2",
} as const;

export interface SpinnerProps {
  size?: keyof typeof SIZE;
  className?: string;
}

/** Bare ring, for when the surrounding element already says what's loading (a button, say). */
export function Spinner({ size = "default", className }: SpinnerProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0 rounded-full border-line-strong border-t-accent",
        // Reduced motion gets a slow turn rather than a frozen ring — a
        // static circle reads as "stuck", which is the opposite of the point.
        "animate-spin motion-reduce:[animation-duration:2.4s]",
        SIZE[size],
        className,
      )}
    />
  );
}

export interface LoaderProps extends SpinnerProps {
  /** Announced to screen readers and shown beside the ring. */
  label?: string;
  /** Centre it in the viewport — for route-level waits before any chrome renders. */
  fullPage?: boolean;
}

/**
 * The one loading indicator. Every screen that waits on a fetch shows this
 * rather than a bare "Loading…" line, so a slow network looks the same
 * everywhere instead of like a half-painted page.
 */
export function Loader({
  label = "Loading…",
  size = "default",
  fullPage = false,
  className,
}: LoaderProps) {
  const body = (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-2.5 px-1 py-2.5 text-[13px] text-ink-faint",
        className,
      )}
    >
      <Spinner size={size} />
      <span>{label}</span>
    </div>
  );

  if (!fullPage) return body;

  return (
    <div className="flex min-h-screen items-center justify-center">{body}</div>
  );
}
