import type { ReactNode } from "react";
import { Label } from "./label";
import { cn } from "@/lib/utils";

interface FormFieldProps {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: string | undefined;
  optional?: boolean;
  className?: string | undefined;
  children: ReactNode;
}

/** Label + control + hint/error, laid out consistently. Error replaces the hint rather than stacking, so the field never jumps twice. */
export function FormField({
  label,
  htmlFor,
  error,
  hint,
  optional,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cn("mb-4 flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {optional ? (
          <span className="font-normal text-ink-faint"> (optional)</span>
        ) : null}
      </Label>
      {children}
      {hint && !error ? (
        <span className="text-[12px] text-ink-faint">{hint}</span>
      ) : null}
      {error ? (
        <span className="text-[12px] font-medium text-critical" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
