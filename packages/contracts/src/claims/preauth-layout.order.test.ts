import { describe, expect, it } from "vitest";
import { layoutPlacements } from "./preauth-layout.js";

/** Two columns, each numbered from zero — what the seed actually writes. */
function layout() {
  const place = (id: string, displayOrder: number, columnPosition: number) => ({
    id,
    displayOrder,
    columnPosition,
    labelOverride: null,
    required: false,
    definition: {
      id: `d-${id}`,
      fieldKey: id,
      label: id,
      fieldType: "text" as const,
      hint: null,
      options: null,
      isStandard: true,
      conditionalOn: null,
    },
  });
  return {
    id: "l1",
    name: "IRDAI standard form",
    insurerId: null,
    sections: [
      {
        id: "s1",
        name: "Clinical details",
        displayOrder: 0,
        columnCount: 2,
        // Deliberately shuffled: the function must impose the order,
        // not inherit the array's.
        placements: [
          place("right-1", 1, 1),
          place("left-0", 0, 0),
          place("left-1", 1, 0),
          place("right-0", 0, 1),
        ],
      },
    ],
  } as unknown as Parameters<typeof layoutPlacements>[0];
}

describe("layoutPlacements", () => {
  it("reads row by row, left column before right", () => {
    expect(layoutPlacements(layout()).map((p) => p.id)).toEqual([
      "left-0",
      "right-0",
      "left-1",
      "right-1",
    ]);
  });
});
