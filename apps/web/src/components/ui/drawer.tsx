import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

/**
 * A panel that slides in from the right, as the b2b-crm's record panels
 * do.
 *
 * Built on the same Radix dialog the modals use rather than a hand-rolled
 * fixed div, so escape-to-close, the focus trap, the return of focus to
 * whatever opened it, and the aria wiring are the ones every other
 * overlay in the app already has. The only real difference from
 * `DialogContent` is where it sits and which way it comes in.
 */

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Full-width, for a panel showing a table or a chart. */
    wide?: boolean;
  }
>(({ className, children, wide = false, ...props }, ref) => (
  <DialogPrimitive.Portal>
    {/* Lighter than the modal scrim: a drawer is somewhere you work
        beside the page, not a question that stops it. */}
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/25 motion-safe:animate-in motion-safe:fade-in" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Two widths, because the panel does two jobs. Reading an
        // answer about a claim wants the claim still visible beside it;
        // reading a table of forty receivables wants the room. Wide was
        // the only option and it covered the whole page — including the
        // claim the panel was being asked about.
        //
        // Floors on both so the panel stays usable on a phone (a
        // percentage of a 375px screen is a column nothing reads well
        // in), and never wider than the viewport itself.
        "fixed inset-y-0 right-0 z-50 flex flex-col",
        wide
          ? "w-[min(100vw,max(85vw,420px))]"
          : "w-[min(100vw,max(46vw,420px))]",
        "transition-[width] motion-reduce:transition-none",
        "border-l border-line bg-surface shadow-[-14px_0_44px_rgba(0,0,0,0.18)]",
        "motion-safe:animate-in motion-safe:slide-in-from-right-[100%] motion-safe:duration-200",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DrawerContent.displayName = "DrawerContent";

/**
 * The fixed header. Separate from the body because the body scrolls and
 * this must not — a drawer you have scrolled to the bottom of still has
 * to tell you what it is and offer a way out.
 */
export function DrawerHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <DialogPrimitive.Title className="text-md font-semibold text-ink">
          {title}
        </DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-0.5 text-sm text-ink-faint">
            {description}
          </DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">
            {title}
          </DialogPrimitive.Description>
        )}
      </div>
      {children}
    </div>
  );
}
