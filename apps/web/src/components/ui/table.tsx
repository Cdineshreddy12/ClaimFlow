import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The b2b-crm's data table: a full grid.
 *
 * Every cell carries a right rule, so columns are separated by lines
 * rather than by whitespace, and the header is the same white as the
 * body — the grid alone says where the header ends. Header labels are
 * sentence case at reading size; uppercase 11px headers read as
 * captions floating above the data instead of as a header row.
 */

/**
 * The card a table lives in. Unpadded and clipping, so the grid runs
 * edge to edge and the rounded corners cut it — that's what makes a
 * table read as one object rather than a grid inside a box.
 */
export const TableCard = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "overflow-hidden rounded-lg border border-line bg-surface-raised shadow-card",
      className,
    )}
    {...props}
  />
));
TableCard.displayName = "TableCard";

/**
 * A claims table has an irreducible minimum width — let it scroll
 * inside its own card rather than pushing the whole page sideways.
 */
export const Table = React.forwardRef<
  HTMLTableElement,
  React.TableHTMLAttributes<HTMLTableElement> & {
    minWidth?: number;
    /**
     * Makes this wrapper the thing that scrolls, so the headers stay
     * in view. Only works inside a parent that bounds the table's
     * height — on a document-height page there is nothing to scroll
     * within and the header never moves.
     */
    stickyHeader?: boolean;
  }
>(({ className, minWidth = 440, stickyHeader = false, ...props }, ref) => (
  <div
    className={cn(
      "w-full overflow-x-auto",
      stickyHeader && "min-h-0 flex-1 overflow-y-auto",
    )}
  >
    <table
      ref={ref}
      style={{ minWidth }}
      className={cn(
        "w-full border-collapse text-base",
        /*
          On the cells, not `thead`: Safari won't position a sticky
          section. Opaque, or rows show through underneath. The bottom
          edge is an inset shadow because `border-collapse` drops a
          real border once the cell leaves the flow.
        */
        stickyHeader &&
          "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-surface-raised [&_thead_th]:shadow-[inset_0_-1px_0_var(--border)]",
        className,
      )}
      {...props}
    />
  </div>
));
Table.displayName = "Table";

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={className} {...props} />
));
TableHeader.displayName = "TableHeader";

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child_td]:border-b-0", className)}
    {...props}
  />
));
TableBody.displayName = "TableBody";

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  // Neutral hover, like the CRM's. A blue-tinted hover on a table whose
  // links are also blue made the pointer look like it was selecting.
  <tr
    ref={ref}
    className={cn("hover:bg-hover [&>td:last-child]:border-r-0", className)}
    {...props}
  />
));
TableRow.displayName = "TableRow";

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "whitespace-nowrap border-b border-r border-line px-3.5 py-[11px] text-left text-base font-medium text-ink last:border-r-0",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "border-b border-r border-line px-3.5 py-[11px] align-middle last:border-r-0",
      className,
    )}
    {...props}
  />
));
TableCell.displayName = "TableCell";

/** The count line under a table, as the CRM places it. */
export const TableFooterBar = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex flex-wrap items-center justify-between gap-3 px-0.5 pt-3 text-sm text-ink-soft",
      className,
    )}
    {...props}
  />
));
TableFooterBar.displayName = "TableFooterBar";

/**
 * A sortable column header. The whole header is the hit target, not
 * just the label — an 11px word is a mean thing to ask someone to
 * click. Both chevrons stay visible but faint until the column is
 * sorted: a single caret can't say "you may sort by this" and "this is
 * the sort" with one glyph.
 */
export function SortButton({
  direction,
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  direction: "asc" | "desc" | null;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 font-[inherit] text-[inherit] text-ink-soft hover:text-ink",
        direction && "text-ink",
        className,
      )}
      {...props}
    >
      {children}
      <svg
        viewBox="0 0 8 12"
        aria-hidden
        focusable="false"
        className="h-3 w-2 shrink-0"
      >
        <path
          d="M4 1 L7 4.5 H1 Z"
          className={
            direction === "asc"
              ? "fill-accent opacity-100"
              : "fill-ink-faint opacity-40"
          }
        />
        <path
          d="M4 11 L1 7.5 H7 Z"
          className={
            direction === "desc"
              ? "fill-accent opacity-100"
              : "fill-ink-faint opacity-40"
          }
        />
      </svg>
    </button>
  );
}
