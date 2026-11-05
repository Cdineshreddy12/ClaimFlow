import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
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
Textarea.displayName = "Textarea";
