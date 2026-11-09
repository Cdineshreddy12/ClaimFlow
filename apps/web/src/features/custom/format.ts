import { parseMultiValue, type CustomField } from "@claimflow/contracts";

/**
 * How a stored answer reads in a module's records table.
 *
 * Its own file rather than sitting beside the form: a module exporting
 * both a component and a helper breaks fast refresh, and the editor
 * reloading the whole page on every keystroke is a worse trade than
 * one extra import.
 *
 * Everything is stored as a canonical string — "2026-11-08", "true",
 * a JSON array — and none of those are what a desk should have to
 * read off a table.
 */
export function formatValue(field: CustomField, raw: string | undefined) {
  if (!raw) return "—";

  switch (field.fieldType) {
    case "currency": {
      const n = Number(raw);
      return Number.isNaN(n) ? raw : `₹${n.toLocaleString("en-IN")}`;
    }
    case "date": {
      const at = new Date(`${raw}T00:00:00`);
      return Number.isNaN(at.getTime())
        ? raw
        : at.toLocaleDateString("en-IN", { dateStyle: "medium" });
    }
    case "datetime": {
      const at = new Date(raw);
      return Number.isNaN(at.getTime())
        ? raw
        : at.toLocaleString("en-IN", {
            dateStyle: "medium",
            timeStyle: "short",
          });
    }
    // Only ever stored when ticked, so there is no "No" to print.
    case "checkbox":
      return raw === "true" ? "Yes" : "—";
    case "multienum": {
      const chosen = parseMultiValue(raw);
      return chosen.length > 0 ? chosen.join(", ") : "—";
    }
    default:
      return raw;
  }
}
