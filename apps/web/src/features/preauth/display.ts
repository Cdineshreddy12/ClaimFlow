import type { PreauthFieldDef } from "@claimflow/contracts";
import { formatAmount } from "../../lib/format";

/**
 * Turns a stored canonical value into what a desk executive reads.
 *
 * Storage is canonical so it can be validated and compared —
 * "185000.00", "2026-10-30", "surgical_management". None of those are
 * what anyone wants to see on a form, and the round trip only works if
 * this is the single place the translation happens.
 */
export function formatPreauthValue(
  field: PreauthFieldDef,
  value: string | null,
): string {
  if (value === null || value === "") return "—";

  switch (field.type) {
    case "currency":
      return formatAmount(value);
    case "date": {
      const parsed = new Date(`${value}T00:00:00`);
      if (Number.isNaN(parsed.getTime())) return value;
      return parsed.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    }
    case "integer":
      // The unit lives in the label ("Expected days in hospital"), so
      // repeating it here would just read as clutter.
      return value;
    case "enum":
      return field.options?.find((o) => o.value === value)?.label ?? value;
    default:
      return value;
  }
}

/**
 * The value a human is editing, as it should appear in the input.
 * Currency and dates go back to their raw form — a date input wants
 * 2026-10-30, and asking someone to retype "₹1,85,000" with the symbol
 * would just fail validation.
 */
export function editableValue(value: string | null): string {
  if (value === null) return "";
  // Trailing ".00" on a whole-rupee figure is noise in a text box.
  return value.endsWith(".00") ? value.slice(0, -3) : value;
}

/** Which HTML input type suits the field, for the inline editor. */
export function inputTypeFor(field: PreauthFieldDef): string {
  switch (field.type) {
    case "date":
      return "date";
    case "time":
      return "time";
    case "integer":
    case "currency":
      return "number";
    default:
      return "text";
  }
}
