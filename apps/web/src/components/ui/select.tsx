import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check as CheckIcon, ChevronDown } from "reicon-react";
import { cn } from "@/lib/utils";

/**
 * Radix-backed select. A native <select>'s dropdown is painted by the OS,
 * so its popup ignored the app's dark palette entirely — this renders the
 * list as real DOM we control, which is the whole reason it exists.
 */
export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-surface-raised",
      "px-3 py-2.5 text-[14px] text-ink text-left",
      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "aria-[invalid=true]:border-critical",
      "data-[placeholder]:text-ink-faint",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon className="shrink-0 text-ink-faint">
      <ChevronDown size={13} aria-hidden />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        "relative z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-md border border-line-strong",
        "bg-surface-raised text-ink shadow-[0_10px_28px_rgba(0,0,0,0.28)]",
        "motion-safe:animate-select-in",
        position === "popper" &&
          "w-[var(--radix-select-trigger-width)] translate-y-1",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Viewport className="p-1">
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-sm py-2 pl-3 pr-8 text-[13.5px]",
      "outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-ink",
      "data-[state=checked]:font-semibold",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <span className="absolute right-2.5 flex items-center">
      <SelectPrimitive.ItemIndicator>
        <CheckIcon size={12} aria-hidden />
      </SelectPrimitive.ItemIndicator>
    </span>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;
