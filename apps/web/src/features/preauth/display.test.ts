import { PREAUTH_FIELD_BY_KEY } from "@claimflow/contracts";
import { describe, expect, it } from "vitest";
import { editableValue, formatPreauthValue, inputTypeFor } from "./display";

function field(key: string) {
  const def = PREAUTH_FIELD_BY_KEY[key];
  if (!def) throw new Error(`no such field: ${key}`);
  return def;
}

describe("formatPreauthValue", () => {
  it("renders currency in Indian grouping", () => {
    expect(formatPreauthValue(field("totalExpectedCost"), "185000.00")).toBe(
      "₹1,85,000",
    );
  });

  it("renders a stored date as something a person reads", () => {
    expect(formatPreauthValue(field("admissionDate"), "2026-10-30")).toBe(
      "30 Oct 2026",
    );
  });

  it("renders an enum by its label, not its key", () => {
    expect(
      formatPreauthValue(field("lineOfTreatment"), "surgical_management"),
    ).toBe("Surgical management");
  });

  it("falls back to the raw value for an enum option that no longer exists", () => {
    // A catalogue edit shouldn't blank out a value already on a claim.
    expect(formatPreauthValue(field("lineOfTreatment"), "day_care")).toBe(
      "day_care",
    );
  });

  it("shows an em dash for nothing, rather than an empty box", () => {
    expect(formatPreauthValue(field("icd10Code"), null)).toBe("—");
    expect(formatPreauthValue(field("icd10Code"), "")).toBe("—");
  });

  it("leaves an integer alone — the unit is in the label", () => {
    expect(formatPreauthValue(field("expectedStayDays"), "4")).toBe("4");
  });
});

describe("editableValue", () => {
  it("drops a trailing .00 so a whole-rupee figure isn't noisy to edit", () => {
    expect(editableValue("185000.00")).toBe("185000");
  });

  it("keeps real paise", () => {
    expect(editableValue("4500.50")).toBe("4500.50");
  });

  it("gives an empty string for nothing, so the input stays controlled", () => {
    expect(editableValue(null)).toBe("");
  });
});

describe("inputTypeFor", () => {
  it("picks a native picker where one fits", () => {
    expect(inputTypeFor(field("admissionDate"))).toBe("date");
    expect(inputTypeFor(field("admissionTime"))).toBe("time");
    expect(inputTypeFor(field("otCharges"))).toBe("number");
    expect(inputTypeFor(field("provisionalDiagnosis"))).toBe("text");
  });
});
