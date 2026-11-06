import type { PreauthLayout, PreauthPlacement } from "@claimflow/contracts";

interface FieldRow {
  fieldKey: string;
  value: string | null;
  aiValue: string | null;
  confirmedAt: string | null;
}

export interface PreauthProgress {
  /** The layout's sections with hidden conditional fields already dropped. */
  sections: (PreauthLayout["sections"][number] & {
    placements: PreauthPlacement[];
  })[];
  /** Every field actually on the form right now. */
  applicable: PreauthPlacement[];
  confirmed: number;
  /** Read by the model and still waiting on a human (docs/adr/0005). */
  awaiting: number;
}

/**
 * How far through the pre-auth form this claim is.
 *
 * Shared because the claim file counts it twice — once on the tab badge
 * and once on the card heading — and the two used to disagree. The tab
 * divided by the global field catalogue, a constant, while the card
 * divided by the hospital's own saved layout: "0/24" sat next to "0 of
 * 25 confirmed" on the same form. The denominator belongs to the form
 * on screen, so there is one of it now.
 *
 * Conditional fields key off the raw stored value, never the rendered
 * label: "Surgical management" is not "surgical_management".
 */
export function preauthProgress(input: {
  layout: PreauthLayout | undefined;
  fields: FieldRow[] | undefined;
}): PreauthProgress {
  const rows = input.fields ?? [];
  const byKey = new Map(rows.map((r) => [r.fieldKey, r]));
  const values = Object.fromEntries(rows.map((r) => [r.fieldKey, r.value]));

  function applies(placement: PreauthPlacement): boolean {
    const condition = placement.definition.conditionalOn;
    if (!condition) return true;
    const current = values[condition.fieldKey];
    if (!current) return true;
    return current === condition.equals;
  }

  const sections = (input.layout?.sections ?? [])
    .map((section) => ({
      ...section,
      placements: section.placements.filter(applies),
    }))
    .filter((section) => section.placements.length > 0);

  const applicable = sections.flatMap((section) => section.placements);

  return {
    sections,
    applicable,
    confirmed: applicable.filter(
      (p) => byKey.get(p.definition.fieldKey)?.confirmedAt,
    ).length,
    awaiting: applicable.filter((p) => {
      const row = byKey.get(p.definition.fieldKey);
      return row?.aiValue && !row.confirmedAt;
    }).length,
  };
}
