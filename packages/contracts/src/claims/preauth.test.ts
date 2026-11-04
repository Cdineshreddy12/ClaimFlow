import { describe, expect, it } from "vitest";
import {
  PREAUTH_FIELDS,
  PREAUTH_FIELD_BY_KEY,
  isFieldApplicable,
  parsePreauthValue,
  type PreauthFieldDef,
} from "./preauth.js";

function field(key: string): PreauthFieldDef {
  const def = PREAUTH_FIELD_BY_KEY[key];
  if (!def) throw new Error(`no such field: ${key}`);
  return def;
}

describe("the pre-auth field catalogue", () => {
  it("has no duplicate keys", () => {
    const keys = PREAUTH_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every enum field its options, and no other field any", () => {
    for (const f of PREAUTH_FIELDS) {
      if (f.type === "enum") {
        expect(
          f.options?.length,
          `${f.key} is an enum with no options`,
        ).toBeGreaterThan(0);
      } else {
        expect(
          f.options,
          `${f.key} isn't an enum but has options`,
        ).toBeUndefined();
      }
    }
  });

  it("only makes fields conditional on a field that exists", () => {
    for (const f of PREAUTH_FIELDS) {
      if (!f.conditionalOn) continue;
      const parent = PREAUTH_FIELD_BY_KEY[f.conditionalOn.key];
      expect(parent, `${f.key} depends on a missing field`).toBeDefined();
      expect(
        parent?.options?.some((o) => o.value === f.conditionalOn?.equals),
        `${f.key} depends on a value its parent can't hold`,
      ).toBe(true);
    }
  });
});

describe("isFieldApplicable", () => {
  it("keeps a conditional field visible while its condition is unanswered", () => {
    // Unanswered is not the same as ruled out — hiding the surgery
    // fields before anyone has said it isn't surgery would be guessing.
    expect(isFieldApplicable(field("surgeryName"), {})).toBe(true);
    expect(
      isFieldApplicable(field("surgeryName"), { lineOfTreatment: null }),
    ).toBe(true);
  });

  it("drops it once the condition is answered the other way", () => {
    expect(
      isFieldApplicable(field("surgeryName"), {
        lineOfTreatment: "medical_management",
      }),
    ).toBe(false);
  });

  it("keeps it when the condition is met", () => {
    expect(
      isFieldApplicable(field("surgeryName"), {
        lineOfTreatment: "surgical_management",
      }),
    ).toBe(true);
  });

  it("treats an unconditional field as always applicable", () => {
    expect(isFieldApplicable(field("provisionalDiagnosis"), {})).toBe(true);
  });
});

describe("parsePreauthValue", () => {
  it("rejects a currency value the model wrote out in words", () => {
    // The actual failure worth guarding: a wrong figure on a form a TPA
    // authorises against is worse than a blank one.
    expect(
      parsePreauthValue(field("totalExpectedCost"), "approx 1.8 lakh"),
    ).toBeNull();
    expect(
      parsePreauthValue(field("totalExpectedCost"), "1.8 lakh"),
    ).toBeNull();
    expect(
      parsePreauthValue(field("totalExpectedCost"), "1,50,000 - 2,00,000"),
    ).toBeNull();
  });

  it("takes a figure written the way an Indian tariff sheet writes it", () => {
    // Lakh grouping and a currency prefix are notation, not imprecision.
    // Rejecting them would drop most real estimate-sheet figures.
    for (const written of [
      "1,85,000",
      "₹1,85,000",
      "Rs. 1,85,000",
      "Rs 1,85,000/-",
      "INR 185000",
    ]) {
      expect(
        parsePreauthValue(field("totalExpectedCost"), written),
        `failed on ${written}`,
      ).toBe("185000.00");
    }
  });

  it("canonicalises a clean currency value to two decimals", () => {
    expect(parsePreauthValue(field("totalExpectedCost"), "185000")).toBe(
      "185000.00",
    );
    expect(parsePreauthValue(field("otCharges"), " 42500.5 ")).toBe("42500.50");
  });

  it("rejects a date that passes the shape check but isn't a real day", () => {
    expect(parsePreauthValue(field("admissionDate"), "2026-02-31")).toBeNull();
    expect(parsePreauthValue(field("admissionDate"), "30-10-2026")).toBeNull();
    expect(parsePreauthValue(field("admissionDate"), "2026-10-30")).toBe(
      "2026-10-30",
    );
  });

  it("takes a 24-hour time and rejects anything else", () => {
    expect(parsePreauthValue(field("admissionTime"), "09:40")).toBe("09:40");
    expect(parsePreauthValue(field("admissionTime"), "24:00")).toBeNull();
    expect(parsePreauthValue(field("admissionTime"), "9:40 PM")).toBeNull();
  });

  it("only takes whole numbers for an integer field", () => {
    expect(parsePreauthValue(field("expectedStayDays"), "4")).toBe("4");
    expect(parsePreauthValue(field("expectedStayDays"), "3-4")).toBeNull();
    expect(parsePreauthValue(field("expectedStayDays"), "about 4")).toBeNull();
  });

  it("only takes an enum value the field actually offers", () => {
    expect(
      parsePreauthValue(field("lineOfTreatment"), "surgical_management"),
    ).toBe("surgical_management");
    // The model answering in prose rather than with a key.
    expect(
      parsePreauthValue(field("lineOfTreatment"), "Surgical Management"),
    ).toBeNull();
  });

  it("treats blank and whitespace as nothing found", () => {
    expect(parsePreauthValue(field("provisionalDiagnosis"), "   ")).toBeNull();
    expect(parsePreauthValue(field("provisionalDiagnosis"), "")).toBeNull();
  });

  it("truncates overlong prose rather than dropping it", () => {
    // A clipped clinical finding is still worth showing a human; a
    // dropped one silently loses what the note said.
    const long = "a".repeat(1500);
    const parsed = parsePreauthValue(field("clinicalFindings"), long);
    expect(parsed).toHaveLength(1000);
  });
});
