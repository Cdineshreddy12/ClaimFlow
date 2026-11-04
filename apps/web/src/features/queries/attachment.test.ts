import { describe, expect, it } from "vitest";
import { isRequestedItemAttached } from "./attachment";

describe("isRequestedItemAttached", () => {
  it("matches when the slot name is a substring of the longer requested-item text", () => {
    expect(
      isRequestedItemAttached(
        "Ultrasound report (abdomen), with radiologist's impression",
        ["Ultrasound report (abdomen)"],
      ),
    ).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(
      isRequestedItemAttached("ULTRASOUND REPORT (ABDOMEN)", [
        "ultrasound report (abdomen)",
      ]),
    ).toBe(true);
  });

  it("returns false when nothing satisfied resembles the requested text", () => {
    expect(
      isRequestedItemAttached("Updated CBC report", [
        "Pre-authorization form",
        "Photo ID proof",
      ]),
    ).toBe(false);
  });

  it("returns false against an empty satisfied list", () => {
    expect(isRequestedItemAttached("Ultrasound report", [])).toBe(false);
  });
});
