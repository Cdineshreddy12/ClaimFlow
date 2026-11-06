import type { PreauthLayout } from "@claimflow/contracts";
import { describe, expect, it } from "vitest";
import { preauthProgress } from "./progress";

function placement(fieldKey: string, conditionalOn?: unknown) {
  return {
    definition: { fieldKey, label: fieldKey, type: "text", conditionalOn },
  };
}

const LAYOUT = {
  sections: [
    {
      title: "Clinical details",
      placements: [placement("treating_doctor"), placement("diagnosis")],
    },
    {
      title: "Surgery",
      placements: [
        placement("line_of_treatment"),
        placement("surgery_date", {
          fieldKey: "line_of_treatment",
          equals: "surgical_management",
        }),
      ],
    },
  ],
} as unknown as PreauthLayout;

function field(fieldKey: string, over: Record<string, unknown> = {}) {
  return {
    fieldKey,
    value: null,
    aiValue: null,
    confirmedAt: null,
    ...over,
  } as never;
}

describe("preauthProgress", () => {
  it("counts against the hospital's own layout, not the field catalogue", () => {
    // The tab badge used to divide by the global catalogue, a constant,
    // while the card divided by the saved layout: "0/24" sat next to
    // "0 of 25 confirmed" on one form. The denominator belongs to the
    // form on screen.
    const { applicable } = preauthProgress({ layout: LAYOUT, fields: [] });

    expect(applicable).toHaveLength(4);
  });

  it("drops a conditional field whose condition isn't met", () => {
    const { applicable } = preauthProgress({
      layout: LAYOUT,
      fields: [field("line_of_treatment", { value: "conservative" })],
    });

    expect(applicable.map((p) => p.definition.fieldKey)).not.toContain(
      "surgery_date",
    );
  });

  it("keeps the conditional field once the condition is met", () => {
    const { applicable } = preauthProgress({
      layout: LAYOUT,
      fields: [field("line_of_treatment", { value: "surgical_management" })],
    });

    expect(applicable.map((p) => p.definition.fieldKey)).toContain(
      "surgery_date",
    );
  });

  it("separates what a human confirmed from what is still waiting on one", () => {
    const { confirmed, awaiting } = preauthProgress({
      layout: LAYOUT,
      fields: [
        field("treating_doctor", { confirmedAt: "2026-11-06T10:00:00Z" }),
        // Read by the model, nobody has agreed to it yet (docs/adr/0005).
        field("diagnosis", { aiValue: "Cholelithiasis" }),
      ],
    });

    expect(confirmed).toBe(1);
    expect(awaiting).toBe(1);
  });

  it("never counts a hidden field as outstanding", () => {
    // A field that isn't on the form can't be filled in, so counting it
    // leaves a progress number that never reaches its own total.
    const { confirmed, applicable } = preauthProgress({
      layout: LAYOUT,
      fields: [
        field("line_of_treatment", {
          value: "conservative",
          confirmedAt: "2026-11-06T10:00:00Z",
        }),
        field("treating_doctor", { confirmedAt: "2026-11-06T10:00:00Z" }),
        field("diagnosis", { confirmedAt: "2026-11-06T10:00:00Z" }),
      ],
    });

    expect(applicable).toHaveLength(3);
    expect(confirmed).toBe(3);
  });

  it("is empty rather than broken before the layout arrives", () => {
    const { applicable, confirmed, awaiting } = preauthProgress({
      layout: undefined,
      fields: undefined,
    });

    expect(applicable).toEqual([]);
    expect(confirmed).toBe(0);
    expect(awaiting).toBe(0);
  });
});
