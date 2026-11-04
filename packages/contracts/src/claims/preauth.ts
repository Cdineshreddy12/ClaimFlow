import { z } from "zod";

/**
 * The pre-authorisation form, as a catalogue both sides read.
 *
 * These are the fields in the "TO BE FILLED BY THE TREATING DOCTOR /
 * HOSPITAL" and "Details of the patient admitted" sections of IRDAI's
 * standard cashless request form — the part a desk executive copies out
 * of a doctor's note by hand today. The patient/insured half of the form
 * is deliberately absent: it comes off the policy card, not the clinical
 * notes, so there is nothing to read it out of.
 *
 * One catalogue, imported by the API (which extracts against it and
 * validates what comes back) and the web app (which renders it). Same
 * reason CLAIM_TRANSITIONS lives here: a second copy of this list is a
 * second copy that drifts.
 */

export const PreauthFieldGroup = z.enum(["clinical", "admission", "estimate"]);
export type PreauthFieldGroup = z.infer<typeof PreauthFieldGroup>;

export const PREAUTH_GROUP_LABEL: Record<PreauthFieldGroup, string> = {
  clinical: "Clinical details",
  admission: "Admission",
  estimate: "Estimated cost",
};

/**
 * How a value is validated and shown. The distinction that matters is
 * `currency` and `integer` versus `text`: a number that arrives as
 * "approx 2 lakh" must be rejected, not coerced, because a wrong figure
 * on a pre-auth form is worse than an empty one.
 */
export type PreauthFieldType =
  "text" | "longtext" | "date" | "time" | "integer" | "currency" | "enum";

export interface PreauthFieldDef {
  key: string;
  label: string;
  group: PreauthFieldGroup;
  type: PreauthFieldType;
  /** Only for `enum` fields — the allowed values and how they read. */
  options?: { value: string; label: string }[];
  /**
   * Fields the form itself only asks for in one branch. Surgery name is
   * meaningless on a medical-management admission, so it shouldn't be
   * counted as a gap on one.
   */
  conditionalOn?: { key: string; equals: string };
  /** Shown under the field. The form's own wording, where it has any. */
  hint?: string;
}

export const LINE_OF_TREATMENT_OPTIONS = [
  { value: "medical_management", label: "Medical management" },
  { value: "surgical_management", label: "Surgical management" },
  { value: "intensive_care", label: "Intensive care" },
  { value: "investigation", label: "Investigation" },
  { value: "non_allopathic", label: "Non-allopathic treatment" },
] as const;

export const PREAUTH_FIELDS: PreauthFieldDef[] = [
  // --- Clinical: the treating doctor's half of the form -------------------
  {
    key: "treatingDoctorName",
    label: "Treating doctor",
    group: "clinical",
    type: "text",
  },
  {
    key: "treatingDoctorRegistrationNo",
    label: "Doctor's registration no.",
    group: "clinical",
    type: "text",
    hint: "With state code, as it appears on the declaration",
  },
  {
    key: "illnessWithComplaints",
    label: "Illness with presenting complaints",
    group: "clinical",
    type: "longtext",
  },
  {
    key: "clinicalFindings",
    label: "Relevant clinical findings",
    group: "clinical",
    type: "longtext",
  },
  {
    key: "ailmentDurationDays",
    label: "Duration of present ailment",
    group: "clinical",
    type: "integer",
    hint: "In days",
  },
  {
    key: "firstConsultationDate",
    label: "Date of first consultation",
    group: "clinical",
    type: "date",
  },
  {
    key: "provisionalDiagnosis",
    label: "Provisional diagnosis",
    group: "clinical",
    type: "text",
  },
  {
    key: "icd10Code",
    label: "ICD-10 code",
    group: "clinical",
    type: "text",
    hint: "For the provisional diagnosis",
  },
  {
    key: "lineOfTreatment",
    label: "Proposed line of treatment",
    group: "clinical",
    type: "enum",
    options: [...LINE_OF_TREATMENT_OPTIONS],
  },
  {
    key: "surgeryName",
    label: "Name of surgery",
    group: "clinical",
    type: "text",
    conditionalOn: { key: "lineOfTreatment", equals: "surgical_management" },
  },
  {
    key: "icd10PcsCode",
    label: "ICD-10-PCS code",
    group: "clinical",
    type: "text",
    conditionalOn: { key: "lineOfTreatment", equals: "surgical_management" },
  },

  // --- Admission ----------------------------------------------------------
  {
    key: "admissionDate",
    label: "Date of admission",
    group: "admission",
    type: "date",
  },
  {
    key: "admissionTime",
    label: "Time of admission",
    group: "admission",
    type: "time",
  },
  {
    key: "admissionType",
    label: "Emergency or planned",
    group: "admission",
    type: "enum",
    options: [
      { value: "emergency", label: "Emergency" },
      { value: "planned", label: "Planned" },
    ],
  },
  {
    key: "expectedStayDays",
    label: "Expected days in hospital",
    group: "admission",
    type: "integer",
  },
  {
    key: "roomType",
    label: "Room type",
    group: "admission",
    type: "text",
  },

  // --- Estimated cost: the figures a TPA authorises against ---------------
  {
    key: "roomRentPerDay",
    label: "Room rent per day",
    group: "estimate",
    type: "currency",
    hint: "Including nursing, service charges and patient's diet",
  },
  {
    key: "investigationCost",
    label: "Investigation and diagnostics",
    group: "estimate",
    type: "currency",
  },
  {
    key: "icuCharges",
    label: "ICU charges",
    group: "estimate",
    type: "currency",
  },
  {
    key: "otCharges",
    label: "OT charges",
    group: "estimate",
    type: "currency",
  },
  {
    key: "professionalFees",
    label: "Professional fees",
    group: "estimate",
    type: "currency",
    hint: "Surgeon, anaesthetist and consultation charges",
  },
  {
    key: "medicinesConsumables",
    label: "Medicines and consumables",
    group: "estimate",
    type: "currency",
    hint: "Including the cost of implants",
  },
  {
    key: "packageCharges",
    label: "All-inclusive package charges",
    group: "estimate",
    type: "currency",
    hint: "Where the procedure is billed as a package",
  },
  {
    key: "totalExpectedCost",
    label: "Total expected cost",
    group: "estimate",
    type: "currency",
  },
];

export const PREAUTH_FIELD_BY_KEY: Record<string, PreauthFieldDef> =
  Object.fromEntries(PREAUTH_FIELDS.map((f) => [f.key, f]));

export const PREAUTH_FIELD_KEYS: string[] = PREAUTH_FIELDS.map((f) => f.key);

/**
 * Whether a field applies, given what's filled in so far. Until the line
 * of treatment is known the surgical fields are not yet irrelevant, only
 * unanswered — hiding them before that would be guessing on the desk's
 * behalf, so an unset condition keeps them visible.
 */
export function isFieldApplicable(
  field: PreauthFieldDef,
  values: Record<string, string | null | undefined>,
): boolean {
  if (!field.conditionalOn) return true;
  const current = values[field.conditionalOn.key];
  if (!current) return true;
  return current === field.conditionalOn.equals;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const INTEGER_RE = /^\d{1,5}$/;
const CURRENCY_RE = /^\d{1,10}(\.\d{1,2})?$/;

const MAX_TEXT = 200;
const MAX_LONGTEXT = 1000;

/**
 * Removes the notation a real Indian estimate sheet is written in, and
 * nothing else.
 *
 * Every hospital tariff sheet writes "₹1,43,000" or "Rs. 1,43,000", so
 * rejecting the separator would drop most genuine figures. Commas and a
 * currency symbol are unambiguous notation, not imprecision — stripping
 * them is lossless. Words, ranges and "lakh" are left well alone, so
 * "approx 1.8 lakh" still fails the pattern below and is dropped.
 */
function stripNumericNoise(value: string): string {
  return value
    .replace(/^(₹|rs\.?|inr)\s*/i, "")
    .replace(/,/g, "")
    .replace(/\/-$/, "")
    .trim();
}

/**
 * Canonicalises one raw value, or returns null if it isn't usable.
 *
 * Rejecting beats coercing everywhere here. A model asked for a number
 * will sometimes answer "approx 1.8 lakh", and the useful response to
 * that is an empty field the desk fills in, not a confident 1.8 on a
 * form a TPA will authorise against.
 */
export function parsePreauthValue(
  field: PreauthFieldDef,
  raw: string,
): string | null {
  const value = raw.trim();
  if (!value) return null;

  switch (field.type) {
    case "text":
      return value.length <= MAX_TEXT ? value : value.slice(0, MAX_TEXT);
    case "longtext":
      return value.length <= MAX_LONGTEXT
        ? value
        : value.slice(0, MAX_LONGTEXT);
    case "date": {
      if (!DATE_RE.test(value)) return null;
      // Catches 2026-02-31, which the regex is happy with.
      const parsed = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed.toISOString().slice(0, 10) === value ? value : null;
    }
    case "time":
      return TIME_RE.test(value) ? value : null;
    case "integer": {
      const digits = stripNumericNoise(value);
      return INTEGER_RE.test(digits) ? String(Number(digits)) : null;
    }
    case "currency": {
      const digits = stripNumericNoise(value);
      return CURRENCY_RE.test(digits) ? Number(digits).toFixed(2) : null;
    }
    case "enum":
      return field.options?.some((o) => o.value === value) ? value : null;
  }
}

/** Which extractor produced a suggestion, so the UI never overstates it. */
export const PreauthExtractorKind = z.enum(["claude"]);
export type PreauthExtractorKind = z.infer<typeof PreauthExtractorKind>;

export const PREAUTH_EXTRACTOR_LABEL: Record<PreauthExtractorKind, string> = {
  claude: "Read by AI",
};

/** One field the extractor claims to have found, before any validation. */
export const PreauthExtraction = z.object({
  fieldKey: z.string(),
  value: z.string(),
  confidence: z.number().min(0).max(1),
  /** Quoted from the document. Shown to the human before they confirm — adr 0005. */
  sourceSnippet: z.string(),
  /** Which uploaded document it came out of, where the extractor could say. */
  sourceDocumentId: z.string().uuid().nullable().optional(),
});
export type PreauthExtraction = z.infer<typeof PreauthExtraction>;

/** What a desk executive sends when they accept or correct a field. */
export const ConfirmPreauthFieldBody = z.object({
  value: z.string().trim().min(1, "Enter a value").max(MAX_LONGTEXT),
});
export type ConfirmPreauthFieldBody = z.infer<typeof ConfirmPreauthFieldBody>;
