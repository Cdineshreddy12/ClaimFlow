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
/**
 * Exported so a panel on a dark surface can compose its own header.
 * `DrawerHeader` paints for the light drawer, and Radix still wants a
 * titled dialog either way.
 */
export const DrawerTitle = DialogPrimitive.Title;
export const DrawerDescription = DialogPrimitive.Description;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Full-width, for a panel showing a table or a chart. */
    wide?: boolean;
    /**
     * Which edge it comes from. Right is the work panel beside the
     * page; left is navigation, which belongs on the side the rail
     * occupies at every wider size — a nav that flies in from the
     * opposite edge to the one it lives on reads as a different thing.
     */
    side?: "left" | "right";
    /** A nav sheet wants to be thumb-width, not half the screen. */
    widthClassName?: string;
  }
>(
  (
    {
      className,
      children,
      wide = false,
      side = "right",
      widthClassName,
      ...props
    },
    ref,
  ) => (
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
          "fixed inset-y-0 z-50 flex flex-col",
          side === "left" ? "left-0" : "right-0",
          widthClassName ??
            (wide
              ? "w-[min(100vw,max(85vw,420px))]"
              : "w-[min(100vw,max(46vw,420px))]"),
          "transition-[width] motion-reduce:transition-none",
          side === "left"
            ? "border-r border-line bg-surface shadow-[14px_0_44px_rgba(0,0,0,0.18)]"
            : "border-l border-line bg-surface shadow-[-14px_0_44px_rgba(0,0,0,0.18)]",
          side === "left"
            ? "motion-safe:animate-in motion-safe:slide-in-from-left-[100%] motion-safe:duration-200"
            : "motion-safe:animate-in motion-safe:slide-in-from-right-[100%] motion-safe:duration-200",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  ),
);
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
  description?: string | undefined;
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
