import { PREAUTH_FIELD_BY_KEY } from "./preauth.js";

/**
 * Checks a filled pre-auth form against itself, before it goes to an
 * insurer.
 *
 * Insurers raise queries on arithmetic and dates far more often than on
 * clinical substance, and every query costs the desk days. The rules
 * here are the ones a careful desk head would check by hand: that the
 * dates run in the right order, that the line items add up to the
 * total, that nothing was left out that the form's own branches
 * require.
 *
 * All deterministic and all pure. A model reads the clinical coherence
 * (see the auditor integration), but none of the checks below need one,
 * and routing arithmetic through a model would make a checkable fact
 * unexplainable.
 */

export type ReviewSeverity = "blocker" | "warning";

export interface ReviewFinding {
  /** Stable id, so a dismissal could be remembered later. */
  code: string;
  severity: ReviewSeverity;
  /** The fields this is about, for the UI to link to. */
  fieldKeys: string[];
  message: string;
  /** Where the finding came from, so the UI never implies a model ran. */
  source: "rules" | "claude";
}

/** Rupee rounding in the real world: ignore differences under this. */
const ARITHMETIC_TOLERANCE = 1;

function num(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function date(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * `values` is keyed by pre-auth field key and holds confirmed values
 * only — an unconfirmed suggestion is the model's opinion, and a
 * blocker raised against one would be the product arguing with itself.
 */
export function reviewPreauthForm(
  values: Record<string, string | null | undefined>,
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const add = (
    code: string,
    severity: ReviewSeverity,
    fieldKeys: string[],
    message: string,
  ) => findings.push({ code, severity, fieldKeys, message, source: "rules" });

  // --- dates have to run in the order a treatment actually happened ---
  const firstConsultation = date(values.firstConsultationDate);
  const admission = date(values.admissionDate);
  if (firstConsultation && admission && admission < firstConsultation) {
    add(
      "admission_before_consultation",
      "blocker",
      ["admissionDate", "firstConsultationDate"],
      "Admission is dated before the first consultation. An insurer reads this as a back-dated claim.",
    );
  }

  const ailmentDays = num(values.ailmentDurationDays);
  if (firstConsultation && admission && ailmentDays !== null) {
    const gapDays = Math.round(
      (admission.getTime() - firstConsultation.getTime()) / 86_400_000,
    );
    if (ailmentDays < gapDays) {
      add(
        "ailment_shorter_than_consultation_gap",
        "warning",
        ["ailmentDurationDays", "firstConsultationDate"],
        `The ailment is recorded as ${ailmentDays} days, but the first consultation was ${gapDays} days before admission.`,
      );
    }
  }

  // --- the estimate has to add up ---
  const total = num(values.totalExpectedCost);
  const packageCharges = num(values.packageCharges);
  const roomRent = num(values.roomRentPerDay);
  const stayDays = num(values.expectedStayDays);
  const itemKeys = [
    "investigationCost",
    "icuCharges",
    "otCharges",
    "professionalFees",
    "medicinesConsumables",
  ];
  const items = itemKeys.map((key) => num(values[key]));
  const hasAnyItem = items.some((v) => v !== null) || roomRent !== null;

  if (total !== null && packageCharges !== null && packageCharges > total) {
    add(
      "package_exceeds_total",
      "blocker",
      ["packageCharges", "totalExpectedCost"],
      "The all-inclusive package charge is higher than the total expected cost.",
    );
  }

  // An all-inclusive package is an alternative to itemisation, not an
  // addition to it, so the sum is only checked when the form was
  // actually itemised.
  if (total !== null && packageCharges === null && hasAnyItem) {
    const roomTotal =
      roomRent !== null && stayDays !== null ? roomRent * stayDays : 0;
    const itemised = items.reduce<number>(
      (sum, value) => sum + (value ?? 0),
      roomTotal,
    );
    const difference = total - itemised;
    if (Math.abs(difference) > ARITHMETIC_TOLERANCE) {
      add(
        "items_do_not_sum",
        difference > 0 ? "warning" : "blocker",
        [
          "totalExpectedCost",
          ...itemKeys,
          "roomRentPerDay",
          "expectedStayDays",
        ],
        difference > 0
          ? `The line items come to ${itemised.toLocaleString("en-IN")}, which is ${difference.toLocaleString("en-IN")} less than the total. Something is unaccounted for.`
          : `The line items come to ${itemised.toLocaleString("en-IN")}, which is more than the stated total. An insurer will query the difference.`,
      );
    }
  }

  if (stayDays !== null && stayDays <= 0) {
    add(
      "stay_not_positive",
      "blocker",
      ["expectedStayDays"],
      "Expected stay is zero days on an admission request.",
    );
  }

  if (roomRent !== null && stayDays === null) {
    add(
      "room_rent_without_stay",
      "warning",
      ["roomRentPerDay", "expectedStayDays"],
      "A room rent per day was given with no expected number of days, so the room cost can't be checked.",
    );
  }

  // --- identifiers the insurer rejects the form without ---
  if (!values.treatingDoctorRegistrationNo?.trim()) {
    add(
      "missing_doctor_registration",
      "blocker",
      ["treatingDoctorRegistrationNo"],
      "The treating doctor's registration number is missing. Insurers return the form without it.",
    );
  }

  const icd = values.icd10Code?.trim();
  if (icd && !/^[A-TV-Z][0-9][0-9AB](\.[0-9A-Z]{1,4})?$/i.test(icd)) {
    add(
      "icd10_malformed",
      "warning",
      ["icd10Code"],
      `"${icd}" isn't shaped like an ICD-10 code (for example K81.0).`,
    );
  }

  // --- the form's own conditional branches ---
  const treatment = values.lineOfTreatment?.trim();
  if (treatment === "surgical_management") {
    if (!values.surgeryName?.trim()) {
      add(
        "surgical_without_surgery_name",
        "blocker",
        ["surgeryName", "lineOfTreatment"],
        "Surgical management is selected with no surgery named.",
      );
    }
    if (!num(values.otCharges)) {
      add(
        "surgical_without_ot_charges",
        "warning",
        ["otCharges", "lineOfTreatment"],
        "Surgical management is selected with no OT charges in the estimate.",
      );
    }
  }

  if (treatment === "intensive_care" && !num(values.icuCharges)) {
    add(
      "icu_without_icu_charges",
      "warning",
      ["icuCharges", "lineOfTreatment"],
      "Intensive care is selected with no ICU charges in the estimate.",
    );
  }

  // Surgery named on a non-surgical admission is the same contradiction
  // read from the other side, and the one a desk notices least.
  if (
    treatment &&
    treatment !== "surgical_management" &&
    values.surgeryName?.trim()
  ) {
    add(
      "surgery_named_without_surgical_treatment",
      "warning",
      ["surgeryName", "lineOfTreatment"],
      `A surgery is named, but the line of treatment is ${PREAUTH_FIELD_BY_KEY.lineOfTreatment?.options?.find((o) => o.value === treatment)?.label ?? treatment}.`,
    );
  }

  return findings;
}

/** Blockers first — they're the ones that come back as a query. */
export function sortFindings(findings: ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort(
    (a, b) =>
      Number(b.severity === "blocker") - Number(a.severity === "blocker"),
  );
}

export interface PreauthReview {
  findings: ReviewFinding[];
  blockers: number;
  warnings: number;
  /** False when no model ran, so the UI can say the clinical read was skipped. */
  clinicalReviewRan: boolean;
}
