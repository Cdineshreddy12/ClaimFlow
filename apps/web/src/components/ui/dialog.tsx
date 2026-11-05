import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/35 motion-safe:animate-in motion-safe:fade-in" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2",
        "max-h-[calc(100vh-4rem)] overflow-y-auto rounded-lg border border-line",
        "bg-surface-raised p-7 shadow-[0_20px_50px_rgba(0,0,0,0.25)]",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

export function DialogHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-6">
      <DialogPrimitive.Title className="text-[18px] font-semibold -tracking-[0.01em]">
        {title}
      </DialogPrimitive.Title>
      {description ? (
        <DialogPrimitive.Description className="mt-1.5 text-[13px] leading-[1.5] text-ink-faint">
          {description}
        </DialogPrimitive.Description>
      ) : (
        // Radix warns without one, and a screen reader deserves better
        // than silence on a dialog that opened.
        <DialogPrimitive.Description className="sr-only">
          {title}
        </DialogPrimitive.Description>
      )}
    </div>
  );
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 flex justify-end gap-2.5 border-t border-line pt-5">
      {children}
    </div>
  );
}
