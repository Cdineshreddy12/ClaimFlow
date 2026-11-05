import { describe, expect, it } from "vitest";
import { PREAUTH_FIELDS } from "./preauth.js";
import {
  buildPreauthSchema,
  defaultLayout,
  layoutPlacements,
  placementLabel,
  type PreauthLayout,
  type PreauthPlacement,
} from "./preauth-layout.js";

function layoutOf(...placements: Partial<PreauthPlacement>[]): PreauthLayout {
  return {
    id: "l1",
    name: "Test",
    insurerId: null,
    sections: [
      {
        id: "s1",
        name: "Section",
        displayOrder: 0,
        columnCount: 1,
        placements: placements.map((p, i) => ({
          id: `p${i}`,
          displayOrder: i,
          columnPosition: 0,
          labelOverride: null,
          required: false,
          definition: {
            id: `d${i}`,
            fieldKey: `field${i}`,
            label: `Field ${i}`,
            fieldType: "text",
            hint: null,
            options: null,
            isStandard: false,
            conditionalOn: null,
          },
          ...p,
        })) as PreauthPlacement[],
      },
    ],
  };
}

describe("defaultLayout", () => {
  it("covers every field in the IRDAI catalogue exactly once", () => {
    // Derived from PREAUTH_FIELDS rather than duplicated — if these ever
    // disagree, the printed PDF and the extractor are reading a
    // different form from the one the desk filled in.
    const keys = layoutPlacements(defaultLayout()).map(
      (p) => p.definition.fieldKey,
    );
    expect(keys.sort()).toEqual(PREAUTH_FIELDS.map((f) => f.key).sort());
  });

  it("marks every standard field as standard", () => {
    expect(
      layoutPlacements(defaultLayout()).every((p) => p.definition.isStandard),
    ).toBe(true);
  });

  it("carries the catalogue's conditional rules through", () => {
    const surgery = layoutPlacements(defaultLayout()).find(
      (p) => p.definition.fieldKey === "surgeryName",
    );
    expect(surgery?.definition.conditionalOn).toEqual({
      fieldKey: "lineOfTreatment",
      equals: "surgical_management",
    });
  });

  it("requires nothing — a partial pre-auth is a normal thing to send", () => {
    expect(layoutPlacements(defaultLayout()).some((p) => p.required)).toBe(
      false,
    );
  });
});

describe("layoutPlacements", () => {
  it("returns sections and placements in display order", () => {
    const layout: PreauthLayout = {
      id: "l",
      name: "n",
      insurerId: null,
      sections: [
        {
          id: "b",
          name: "Second",
          displayOrder: 1,
          columnCount: 1,
          placements: [
            {
              id: "p3",
              displayOrder: 0,
              columnPosition: 0,
              labelOverride: null,
              required: false,
              definition: {
                id: "d3",
                fieldKey: "third",
                label: "Third",
                fieldType: "text",
                hint: null,
                options: null,
                isStandard: false,
                conditionalOn: null,
              },
            },
          ],
        },
        {
          id: "a",
          name: "First",
          displayOrder: 0,
          columnCount: 1,
          placements: [
            {
              id: "p2",
              displayOrder: 1,
              columnPosition: 0,
              labelOverride: null,
              required: false,
              definition: {
                id: "d2",
                fieldKey: "second",
                label: "Second",
                fieldType: "text",
                hint: null,
                options: null,
                isStandard: false,
                conditionalOn: null,
              },
            },
            {
              id: "p1",
              displayOrder: 0,
              columnPosition: 0,
              labelOverride: null,
              required: false,
              definition: {
                id: "d1",
                fieldKey: "first",
                label: "First",
                fieldType: "text",
                hint: null,
                options: null,
                isStandard: false,
                conditionalOn: null,
              },
            },
          ],
        },
      ],
    };
    expect(layoutPlacements(layout).map((p) => p.definition.fieldKey)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });
});

describe("placementLabel", () => {
  it("prefers the layout's override over the definition's label", () => {
    const [placement] = layoutPlacements(
      layoutOf({ labelOverride: "What the TPA calls it" }),
    );
    expect(placementLabel(placement!)).toBe("What the TPA calls it");
  });
});

describe("buildPreauthSchema", () => {
  it("accepts a numeric string without turning a blank into zero", () => {
    // z.coerce.number() would make "" into 0 and silently save a
    // zero amount for a field the user cleared.
    const schema = buildPreauthSchema(
      layoutOf({
        definition: {
          id: "d",
          fieldKey: "cost",
          label: "Cost",
          fieldType: "currency",
          hint: null,
          options: null,
          isStandard: false,
          conditionalOn: null,
        },
      }),
    );
    expect(schema.safeParse({ cost: "185000" })).toMatchObject({
      success: true,
      data: { cost: 185000 },
    });
    expect(schema.safeParse({ cost: "" }).success).toBe(true);
    expect(schema.safeParse({ cost: "" }).data?.cost).toBeNull();
  });

  it("rejects an amount that isn't a number at all", () => {
    const schema = buildPreauthSchema(
      layoutOf({
        definition: {
          id: "d",
          fieldKey: "cost",
          label: "Cost",
          fieldType: "currency",
          hint: null,
          options: null,
          isStandard: false,
          conditionalOn: null,
        },
      }),
    );
    expect(schema.safeParse({ cost: "about two lakh" }).success).toBe(false);
  });

  it("lets an optional field be cleared after it was filled", () => {
    // `.optional()` alone only skips undefined, so a cleared field keeps
    // failing its format validator forever.
    const schema = buildPreauthSchema(
      layoutOf({
        definition: {
          id: "d",
          fieldKey: "when",
          label: "When",
          fieldType: "date",
          hint: null,
          options: null,
          isStandard: false,
          conditionalOn: null,
        },
      }),
    );
    expect(schema.safeParse({ when: "" }).success).toBe(true);
    expect(schema.safeParse({ when: "2026-10-30" }).success).toBe(true);
    expect(schema.safeParse({ when: "30-10-2026" }).success).toBe(false);
  });

  it("rejects everything on a choice field whose options were emptied", () => {
    // A broken layout should fail visibly rather than accept anything.
    const schema = buildPreauthSchema(
      layoutOf({
        definition: {
          id: "d",
          fieldKey: "choice",
          label: "Choice",
          fieldType: "enum",
          hint: null,
          options: [],
          isStandard: false,
          conditionalOn: null,
        },
      }),
    );
    expect(schema.safeParse({ choice: "anything" }).success).toBe(false);
  });

  it("flags a required field that is blank, and accepts one that isn't", () => {
    const schema = buildPreauthSchema(
      layoutOf({
        required: true,
        definition: {
          id: "d",
          fieldKey: "doctor",
          label: "Doctor",
          fieldType: "text",
          hint: null,
          options: null,
          isStandard: false,
          conditionalOn: null,
        },
      }),
    );
    expect(schema.safeParse({ doctor: "   " }).success).toBe(false);
    expect(schema.safeParse({ doctor: "Dr Kulkarni" }).success).toBe(true);
  });

  it("treats a required field that is null in the database as blank, not broken", () => {
    // Happens whenever a field is added to the layout after a claim was
    // opened. The user should see "Required", not a type error.
    const schema = buildPreauthSchema(
      layoutOf({
        required: true,
        definition: {
          id: "d",
          fieldKey: "doctor",
          label: "Doctor",
          fieldType: "text",
          hint: null,
          options: null,
          isStandard: false,
          conditionalOn: null,
        },
      }),
    );
    const result = schema.safeParse({ doctor: null });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Required");
  });

  it("builds a working schema for the whole standard form", () => {
    const schema = buildPreauthSchema(defaultLayout());
    expect(schema.safeParse({}).success).toBe(true);
    expect(
      schema.safeParse({ totalExpectedCost: "129500", icd10Code: "K80.0" })
        .success,
    ).toBe(true);
  });
});
