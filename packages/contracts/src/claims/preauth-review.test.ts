import { describe, expect, it } from "vitest";
import { reviewPreauthForm, sortFindings } from "./preauth-review.js";

/** A form with nothing wrong with it, as the baseline every test perturbs. */
function cleanForm(over: Record<string, string | null> = {}) {
  return {
    treatingDoctorName: "Dr A Rao",
    treatingDoctorRegistrationNo: "KMC/12345",
    illnessWithComplaints: "RUQ pain, vomiting",
    clinicalFindings: "Murphy's sign positive",
    ailmentDurationDays: "10",
    firstConsultationDate: "2026-10-25",
    provisionalDiagnosis: "Acute cholecystitis",
    icd10Code: "K81.0",
    lineOfTreatment: "surgical_management",
    surgeryName: "Laparoscopic cholecystectomy",
    admissionDate: "2026-10-30",
    admissionTime: "09:40",
    admissionType: "planned",
    expectedStayDays: "3",
    roomType: "twin_sharing",
    roomRentPerDay: "6000",
    investigationCost: "12000",
    icuCharges: "0",
    otCharges: "45000",
    professionalFees: "30000",
    medicinesConsumables: "20000",
    packageCharges: null,
    // 6000×3 + 12000 + 0 + 45000 + 30000 + 20000
    totalExpectedCost: "125000",
    ...over,
  };
}

function codes(values: Record<string, string | null>) {
  return reviewPreauthForm(values).map((f) => f.code);
}

describe("reviewPreauthForm", () => {
  it("finds nothing wrong with a consistent form", () => {
    expect(reviewPreauthForm(cleanForm())).toEqual([]);
  });

  describe("dates", () => {
    it("blocks an admission dated before the first consultation", () => {
      const found = reviewPreauthForm(
        cleanForm({ admissionDate: "2026-10-20" }),
      );
      const finding = found.find(
        (f) => f.code === "admission_before_consultation",
      );
      expect(finding?.severity).toBe("blocker");
      expect(finding?.fieldKeys).toContain("admissionDate");
    });

    it("warns when the ailment is shorter than the consultation gap", () => {
      // Consulted 5 days before admission, but the ailment is 2 days old.
      expect(codes(cleanForm({ ailmentDurationDays: "2" }))).toContain(
        "ailment_shorter_than_consultation_gap",
      );
    });

    it("accepts an ailment longer than the gap, which is normal", () => {
      expect(codes(cleanForm({ ailmentDurationDays: "60" }))).not.toContain(
        "ailment_shorter_than_consultation_gap",
      );
    });

    it("says nothing about dates it wasn't given", () => {
      expect(codes(cleanForm({ firstConsultationDate: null }))).not.toContain(
        "admission_before_consultation",
      );
    });

    it("ignores an unparseable date rather than reading it as 1970", () => {
      expect(codes(cleanForm({ admissionDate: "30-10-2026" }))).not.toContain(
        "admission_before_consultation",
      );
    });
  });

  describe("arithmetic", () => {
    it("blocks line items that come to more than the stated total", () => {
      const finding = reviewPreauthForm(
        cleanForm({ totalExpectedCost: "90000" }),
      ).find((f) => f.code === "items_do_not_sum");
      expect(finding?.severity).toBe("blocker");
      expect(finding?.message).toContain("more than the stated total");
    });

    it("warns, not blocks, when the total is higher than the items", () => {
      // Unaccounted-for money is a query, not a contradiction.
      const finding = reviewPreauthForm(
        cleanForm({ totalExpectedCost: "180000" }),
      ).find((f) => f.code === "items_do_not_sum");
      expect(finding?.severity).toBe("warning");
      expect(finding?.message).toContain("unaccounted");
    });

    it("tolerates rupee rounding", () => {
      expect(codes(cleanForm({ totalExpectedCost: "125001" }))).not.toContain(
        "items_do_not_sum",
      );
    });

    it("skips the sum on an all-inclusive package, which isn't itemised", () => {
      expect(
        codes(
          cleanForm({ packageCharges: "120000", totalExpectedCost: "125000" }),
        ),
      ).not.toContain("items_do_not_sum");
    });

    it("blocks a package charge larger than the total", () => {
      expect(
        codes(
          cleanForm({ packageCharges: "200000", totalExpectedCost: "125000" }),
        ),
      ).toContain("package_exceeds_total");
    });

    it("blocks a zero-day stay", () => {
      expect(codes(cleanForm({ expectedStayDays: "0" }))).toContain(
        "stay_not_positive",
      );
    });

    it("warns when a room rent can't be multiplied by anything", () => {
      expect(
        codes(cleanForm({ expectedStayDays: null, totalExpectedCost: null })),
      ).toContain("room_rent_without_stay");
    });

    it("says nothing about arithmetic on an empty estimate", () => {
      const blank = cleanForm({
        roomRentPerDay: null,
        investigationCost: null,
        icuCharges: null,
        otCharges: null,
        professionalFees: null,
        medicinesConsumables: null,
        totalExpectedCost: null,
        expectedStayDays: null,
      });
      expect(codes(blank)).not.toContain("items_do_not_sum");
    });
  });

  describe("identifiers", () => {
    it("blocks a missing doctor registration number", () => {
      const finding = reviewPreauthForm(
        cleanForm({ treatingDoctorRegistrationNo: "   " }),
      ).find((f) => f.code === "missing_doctor_registration");
      expect(finding?.severity).toBe("blocker");
    });

    it("warns on an ICD-10 code that isn't shaped like one", () => {
      expect(codes(cleanForm({ icd10Code: "cholecystitis" }))).toContain(
        "icd10_malformed",
      );
    });

    it("accepts real ICD-10 shapes", () => {
      for (const code of ["K81.0", "J18", "S72.001A", "A09"]) {
        expect(codes(cleanForm({ icd10Code: code }))).not.toContain(
          "icd10_malformed",
        );
      }
    });

    it("doesn't complain about an ICD-10 code nobody has entered yet", () => {
      expect(codes(cleanForm({ icd10Code: null }))).not.toContain(
        "icd10_malformed",
      );
    });
  });

  describe("the form's own branches", () => {
    it("blocks surgical management with no surgery named", () => {
      expect(codes(cleanForm({ surgeryName: null }))).toContain(
        "surgical_without_surgery_name",
      );
    });

    it("warns about surgical management with no OT charges", () => {
      expect(
        codes(cleanForm({ otCharges: null, totalExpectedCost: "80000" })),
      ).toContain("surgical_without_ot_charges");
    });

    it("warns about intensive care with no ICU charges", () => {
      expect(
        codes(
          cleanForm({
            lineOfTreatment: "intensive_care",
            surgeryName: null,
            icuCharges: null,
            otCharges: null,
            totalExpectedCost: "80000",
          }),
        ),
      ).toContain("icu_without_icu_charges");
    });

    it("notices a surgery named on a medical admission", () => {
      const finding = reviewPreauthForm(
        cleanForm({
          lineOfTreatment: "medical_management",
          otCharges: null,
          totalExpectedCost: "80000",
        }),
      ).find((f) => f.code === "surgery_named_without_surgical_treatment");
      expect(finding).toBeDefined();
      // Reads back the label, not the stored key.
      expect(finding?.message).toContain("Medical management");
    });

    it("doesn't ask for a surgery name when no treatment is chosen yet", () => {
      expect(
        codes(cleanForm({ lineOfTreatment: null, surgeryName: null })),
      ).not.toContain("surgical_without_surgery_name");
    });
  });

  it("marks every finding as coming from rules, not a model", () => {
    const found = reviewPreauthForm(cleanForm({ admissionDate: "2026-10-20" }));
    expect(found.every((f) => f.source === "rules")).toBe(true);
  });
});

describe("sortFindings", () => {
  it("puts blockers above warnings", () => {
    const sorted = sortFindings([
      {
        code: "w",
        severity: "warning",
        fieldKeys: [],
        message: "",
        source: "rules",
      },
      {
        code: "b",
        severity: "blocker",
        fieldKeys: [],
        message: "",
        source: "claude",
      },
    ]);
    expect(sorted.map((f) => f.code)).toEqual(["b", "w"]);
  });
});
