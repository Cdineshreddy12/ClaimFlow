import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2.5 text-[14px] text-ink",
        "placeholder:text-ink-faint",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-[invalid=true]:border-critical",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
