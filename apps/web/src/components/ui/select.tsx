import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check as CheckIcon, ChevronDown, ChevronUp } from "reicon-react";
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
      // One line, always. A trigger that grows when you pick a longer
      // option moves everything below it — on the insurer form,
      // choosing "Government scheme" pushed Add down by a row and out
      // from under the cursor that was about to press it.
      "whitespace-nowrap [&>span]:min-w-0 [&>span]:truncate",
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

/**
 * The two ends of a list taller than the popup.
 *
 * Radix only renders these when there is actually more to see, so a
 * short list is unaffected. Without them a clipped list just stops:
 * the viewport scrolls on a wheel, but nothing on screen says it can,
 * and the status filter runs to twelve rows.
 */
const scrollButton =
  "flex cursor-default items-center justify-center py-1 text-ink-faint";

export const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(scrollButton, className)}
    {...props}
  >
    <ChevronUp size={13} aria-hidden />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

export const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(scrollButton, className)}
    {...props}
  >
    <ChevronDown size={13} aria-hidden />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName;

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        // Grows to fit, bounded by whatever room the trigger actually
        // has. A flat 18rem clipped the twelve-row status filter at
        // two-thirds with 450px of empty screen underneath it. The
        // 32rem cap keeps an unbounded list — a hospital's procedures,
        // say — from becoming a full-height wall.
        "relative z-50 min-w-[8rem] overflow-hidden rounded-md border border-line-strong",
        "max-h-[min(32rem,var(--radix-select-content-available-height))]",
        "bg-surface-raised text-ink shadow-[0_10px_28px_rgba(0,0,0,0.28)]",
        "motion-safe:animate-select-in",
        position === "popper" &&
          "w-[var(--radix-select-trigger-width)] translate-y-1",
        className,
      )}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport className="p-1">
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

/** Names a group of options. Styled as a heading, never as a choosable row. */
export const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn(
      "px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-[0.06em] text-ink-faint",
      className,
    )}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

export const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("my-1 h-px bg-line", className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

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
