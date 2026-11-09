import { describe, expect, it } from "vitest";
import { PREAUTH_FIELD_TYPE_BY_KEY } from "../claims/preauth-layout.js";
import {
  CUSTOM_FIELD_TYPES,
  CustomFieldInput,
  parseMultiValue,
  pruneToFields,
  serialiseMultiValue,
  slugify,
  takesOptions,
  validateRecord,
  type CustomField,
} from "./module.js";

function field(over: Partial<CustomField> & { fieldKey: string }): CustomField {
  return {
    id: over.fieldKey,
    moduleId: "m",
    label: over.fieldKey,
    fieldType: "text",
    required: false,
    options: null,
    helpText: null,
    showInList: true,
    sortOrder: 0,
    ...over,
  };
}

describe("CUSTOM_FIELD_TYPES", () => {
  /*
    The whole reason the two registries are allowed to be different
    lists: the types they share must stay identical. Without this,
    renaming "Choice" to "Dropdown" in one builder leaves the other
    saying "Choice" for the same stored field_type.
  */
  it("keeps the pre-auth registry's label for every type they share", () => {
    const shared = CUSTOM_FIELD_TYPES.filter(
      (t) => PREAUTH_FIELD_TYPE_BY_KEY[t.type] !== undefined,
    );

    expect(shared.length).toBeGreaterThan(0);
    for (const def of shared) {
      expect(def.label).toBe(PREAUTH_FIELD_TYPE_BY_KEY[def.type]?.label);
    }
  });

  it("offers no file upload, which it has no picker for", () => {
    expect(CUSTOM_FIELD_TYPES.map((t) => t.type)).not.toContain("file");
  });

  it("names every type exactly once", () => {
    const types = CUSTOM_FIELD_TYPES.map((t) => t.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it("knows which types are configured with choices", () => {
    expect(takesOptions("enum")).toBe(true);
    expect(takesOptions("multienum")).toBe(true);
    expect(takesOptions("text")).toBe(false);
  });
});

describe("slugify", () => {
  it("makes a URL segment out of a name a human typed", () => {
    expect(slugify("Ward round")).toBe("ward-round");
    expect(slugify("  Implant   Register! ")).toBe("implant-register");
  });

  it("never leaves a leading or trailing hyphen", () => {
    expect(slugify("— Ward round —")).toBe("ward-round");
  });
});

describe("validateRecord", () => {
  it("asks for a required field and ignores an empty optional one", () => {
    const fields = [
      field({ fieldKey: "patient_name", required: true }),
      field({ fieldKey: "notes" }),
    ];

    const errors = validateRecord(fields, { patient_name: "", notes: "" });

    expect(errors).toEqual([{ fieldKey: "patient_name", message: "Required" }]);
  });

  it("treats whitespace as absent, not as an answer", () => {
    const fields = [field({ fieldKey: "patient_name", required: true })];

    expect(validateRecord(fields, { patient_name: "   " })).toHaveLength(1);
  });

  it("holds each type to its own shape", () => {
    const fields = [
      field({ fieldKey: "count", fieldType: "integer" }),
      field({ fieldKey: "cost", fieldType: "currency" }),
      field({ fieldKey: "day", fieldType: "date" }),
      field({ fieldKey: "at", fieldType: "time" }),
    ];

    const errors = validateRecord(fields, {
      count: "2.5",
      cost: "12.345",
      day: "08-11-2026",
      at: "25:00",
    });

    expect(errors.map((e) => e.fieldKey)).toEqual([
      "count",
      "cost",
      "day",
      "at",
    ]);
  });

  it("accepts the shapes it should", () => {
    const fields = [
      field({ fieldKey: "count", fieldType: "integer" }),
      field({ fieldKey: "cost", fieldType: "currency" }),
      field({ fieldKey: "day", fieldType: "date" }),
      field({ fieldKey: "at", fieldType: "time" }),
    ];

    expect(
      validateRecord(fields, {
        count: "-3",
        cost: "24000.50",
        day: "2026-11-08",
        at: "09:40",
      }),
    ).toEqual([]);
  });

  it("holds a choice to its own options", () => {
    const fields = [
      field({
        fieldKey: "shift",
        fieldType: "enum",
        options: ["Morning", "Night"],
      }),
    ];

    expect(validateRecord(fields, { shift: "Morning" })).toEqual([]);
    expect(validateRecord(fields, { shift: "Afternoon" })).toEqual([
      { fieldKey: "shift", message: "Pick one of the options" },
    ]);
  });

  it("holds the new types to their own shapes", () => {
    const fields = [
      field({ fieldKey: "weight", fieldType: "decimal" }),
      field({ fieldKey: "seen_at", fieldType: "datetime" }),
      field({ fieldKey: "email", fieldType: "email" }),
      field({ fieldKey: "phone", fieldType: "phone" }),
      field({ fieldKey: "link", fieldType: "url" }),
    ];

    const errors = validateRecord(fields, {
      weight: "72.5kg",
      seen_at: "2026-11-08 09:40",
      email: "priya at example.com",
      phone: "12345",
      link: "example.com",
    });

    expect(errors.map((e) => e.fieldKey)).toEqual([
      "weight",
      "seen_at",
      "email",
      "phone",
      "link",
    ]);
  });

  it("accepts the new types' real answers", () => {
    const fields = [
      field({ fieldKey: "weight", fieldType: "decimal" }),
      field({ fieldKey: "seen_at", fieldType: "datetime" }),
      field({ fieldKey: "email", fieldType: "email" }),
      field({ fieldKey: "phone", fieldType: "phone" }),
      field({ fieldKey: "link", fieldType: "url" }),
    ];

    expect(
      validateRecord(fields, {
        weight: "72.5",
        seen_at: "2026-11-08T09:40",
        email: "priya@example.com",
        phone: "+91 98765 43210",
        link: "https://example.com/x",
      }),
    ).toEqual([]);
  });

  it("refuses a link the browser wouldn't open", () => {
    // Otherwise a records table turns into a javascript: launcher.
    const fields = [field({ fieldKey: "link", fieldType: "url" })];

    expect(
      validateRecord(fields, { link: "javascript:alert(1)" }),
    ).toHaveLength(1);
  });

  it("holds a multiple choice to its own options", () => {
    const fields = [
      field({
        fieldKey: "seen_by",
        fieldType: "multienum",
        options: ["Surgeon", "Anaesthetist", "Physio"],
      }),
    ];

    expect(validateRecord(fields, { seen_by: '["Surgeon","Physio"]' })).toEqual(
      [],
    );
    expect(
      validateRecord(fields, { seen_by: '["Surgeon","Chaplain"]' }),
    ).toEqual([{ fieldKey: "seen_by", message: "Pick from the options" }]);
  });

  it("treats a required multiple choice with nothing picked as unanswered", () => {
    const fields = [
      field({
        fieldKey: "seen_by",
        fieldType: "multienum",
        required: true,
        options: ["Surgeon"],
      }),
    ];

    // serialiseMultiValue([]) is "", so this is the same "absent" the
    // other types use rather than a second kind of empty.
    expect(
      validateRecord(fields, { seen_by: serialiseMultiValue([]) }),
    ).toEqual([{ fieldKey: "seen_by", message: "Required" }]);
  });

  it("makes a required tick box mean it has to be ticked", () => {
    const consent = field({
      fieldKey: "consent",
      fieldType: "checkbox",
      required: true,
    });

    expect(validateRecord([consent], { consent: "true" })).toEqual([]);
    expect(validateRecord([consent], { consent: "" })).toEqual([
      { fieldKey: "consent", message: "Required" },
    ]);
  });

  it("leaves an unticked optional box alone", () => {
    const fields = [field({ fieldKey: "isolation", fieldType: "checkbox" })];

    expect(validateRecord(fields, { isolation: "" })).toEqual([]);
  });

  it("says nothing about answers to fields that no longer exist", () => {
    // A desk removing a field should not make every record written
    // before it unsaveable.
    const fields = [field({ fieldKey: "patient_name" })];

    expect(
      validateRecord(fields, { patient_name: "Priya", removed_field: "junk" }),
    ).toEqual([]);
  });
});

describe("pruneToFields", () => {
  it("drops answers the module has no field for", () => {
    const fields = [field({ fieldKey: "a" })];

    expect(pruneToFields(fields, { a: "kept", b: "dropped" })).toEqual({
      a: "kept",
    });
  });

  it("drops empties, so a cleared field reads as absent rather than blank", () => {
    const fields = [field({ fieldKey: "a" }), field({ fieldKey: "b" })];

    expect(pruneToFields(fields, { a: "kept", b: "" })).toEqual({ a: "kept" });
  });
});

describe("multi-choice values", () => {
  it("round-trips through the one string column every type shares", () => {
    expect(parseMultiValue(serialiseMultiValue(["A", "B"]))).toEqual([
      "A",
      "B",
    ]);
  });

  it("reads nothing out of an empty, absent or broken value", () => {
    expect(serialiseMultiValue([])).toBe("");
    expect(parseMultiValue("")).toEqual([]);
    expect(parseMultiValue(null)).toEqual([]);
    expect(parseMultiValue("not json")).toEqual([]);
    expect(parseMultiValue('"a string"')).toEqual([]);
  });

  it("survives an option containing a comma, which a delimiter would not", () => {
    const options = ["Fever, persistent", "Cough"];

    expect(parseMultiValue(serialiseMultiValue(options))).toEqual(options);
  });
});

describe("CustomFieldInput", () => {
  it("insists a choice field has something to choose from", () => {
    const result = CustomFieldInput.safeParse({
      label: "Shift",
      fieldType: "enum",
      required: true,
      showInList: true,
    });

    expect(result.success).toBe(false);
  });

  it("refuses options on a field that can't use them", () => {
    const result = CustomFieldInput.safeParse({
      label: "Notes",
      fieldType: "text",
      required: false,
      showInList: true,
      options: ["a", "b"],
    });

    expect(result.success).toBe(false);
  });

  it("insists a multiple choice has something to choose from too", () => {
    const result = CustomFieldInput.safeParse({
      label: "Seen by",
      fieldType: "multienum",
      required: false,
      showInList: true,
    });

    expect(result.success).toBe(false);
  });

  it("accepts a choice field with options", () => {
    const result = CustomFieldInput.safeParse({
      label: "Shift",
      fieldType: "enum",
      required: true,
      showInList: true,
      options: ["Morning", "Night"],
    });

    expect(result.success).toBe(true);
  });
});
