import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A hairline rule. `role="separator"` rather than a bare div so it is
 * announced as the section break it is; decorative ones pass
 * `decorative` and drop out of the accessibility tree.
 */
export const Separator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    orientation?: "horizontal" | "vertical";
    decorative?: boolean;
  }
>(
  (
    { className, orientation = "horizontal", decorative = false, ...props },
    ref,
  ) => (
    <div
      ref={ref}
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "separator", "aria-orientation": orientation })}
      className={cn(
        "shrink-0 bg-line",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  ),
);
Separator.displayName = "Separator";
