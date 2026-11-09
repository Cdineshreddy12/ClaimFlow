import { beforeEach, describe, expect, it, vi } from "vitest";
import * as claimsRepository from "../claims/claims.repository.js";
import * as documentsRepository from "../documents/documents.repository.js";
import * as orgMembersRepository from "../members/members.repository.js";
import * as preauthIntegration from "../../integrations/preauth/index.js";
import * as ocr from "../../integrations/ocr/textract.js";
import * as s3 from "../../integrations/storage/s3.js";
import * as preauthRepository from "./preauth.repository.js";
import * as preauthLayoutsService from "../preauth-layouts/preauth-layouts.service.js";
import * as auditor from "../../integrations/auditor/claude.js";

vi.mock("./preauth.repository.js");
/*
  `confirmField` asks which field it is being handed, and that question
  walks through the layout service into `preauth-layouts.repository`,
  which opens a database connection. Unmocked, these unit tests passed
  locally only because `.env` pointed at the real Supabase project —
  they were reading from it on every run — and failed in CI, where
  `DATABASE_URL` is unset, with eight copies of "DATABASE_URL is not
  set". CI has been red since.
*/
vi.mock("../preauth-layouts/preauth-layouts.service.js");
vi.mock("../../integrations/auditor/claude.js");
vi.mock("../claims/claims.repository.js");
vi.mock("../documents/documents.repository.js");
vi.mock("../members/members.repository.js");
vi.mock("../../integrations/preauth/index.js");
vi.mock("../../integrations/ocr/textract.js");
vi.mock("../../integrations/storage/s3.js");
vi.mock("../audit/audit.service.js");

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const CLAIM_ID = "33333333-3333-3333-3333-333333333333";
const DOC_ID = "44444444-4444-4444-4444-444444444444";
const MEMBER_ID = "55555555-5555-5555-5555-555555555555";

function auth() {
  return { userId: USER_ID, organizationId: ORG_ID };
}

function claim() {
  return {
    id: CLAIM_ID,
    patientName: "Meera Joshi",
    procedureName: "Gall bladder removal",
  };
}

function confirmedDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID,
    fileUrl: `organizations/x/claims/y/${DOC_ID}-note.png`,
    checklistSlot: "Treating doctor's note",
    confirmedAt: new Date("2026-11-01T10:00:00Z"),
    ...overrides,
  };
}

describe("preauth.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(orgMembersRepository.getMemberId).mockResolvedValue(MEMBER_ID);
    vi.mocked(preauthIntegration.hasPreauthExtractor).mockReturnValue(true);
    vi.mocked(s3.getObjectBytes).mockResolvedValue(new Uint8Array([1, 2]));
    vi.mocked(ocr.canOcr).mockReturnValue(false);
  });

  describe("extractFields", () => {
    it("only sends documents a human has confirmed", async () => {
      // An unconfirmed upload hasn't been vouched for as being what the
      // classifier guessed; reading a pre-auth figure off a misfiled
      // page puts it on a form nobody re-checks.
      const extract = vi
        .fn()
        .mockResolvedValue({ fields: [], documentsRead: 1 });
      vi.mocked(preauthIntegration.getPreauthExtractor).mockReturnValue({
        extract,
      });
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue(
        claim() as never,
      );
      vi.mocked(preauthRepository.listForClaim).mockResolvedValue([] as never);
      vi.mocked(documentsRepository.listForClaim).mockResolvedValue([
        confirmedDoc(),
        confirmedDoc({ id: "unconfirmed", confirmedAt: null }),
        confirmedDoc({ id: "no-slot", checklistSlot: null }),
      ] as never);
      vi.mocked(preauthRepository.saveSuggestions).mockResolvedValue(
        [] as never,
      );

      const { extractFields } = await import("./preauth.service.js");
      const result = await extractFields(auth(), CLAIM_ID);

      const sent = extract.mock.calls[0]?.[0];
      expect(sent.documents).toHaveLength(1);
      expect(sent.documents[0].id).toBe(DOC_ID);
      expect(result.documentsRead).toBe(1);
      expect(result.documentsSkipped).toBe(0);
    });

    it("doesn't ask for fields a human already confirmed", async () => {
      const extract = vi
        .fn()
        .mockResolvedValue({ fields: [], documentsRead: 1 });
      vi.mocked(preauthIntegration.getPreauthExtractor).mockReturnValue({
        extract,
      });
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue(
        claim() as never,
      );
      vi.mocked(preauthRepository.listForClaim).mockResolvedValue([
        {
          fieldKey: "provisionalDiagnosis",
          confirmedAt: new Date(),
          value: "Acute cholecystitis",
        },
      ] as never);
      vi.mocked(documentsRepository.listForClaim).mockResolvedValue([
        confirmedDoc(),
      ] as never);
      vi.mocked(preauthRepository.saveSuggestions).mockResolvedValue(
        [] as never,
      );

      const { extractFields } = await import("./preauth.service.js");
      await extractFields(auth(), CLAIM_ID);

      const sent = extract.mock.calls[0]?.[0];
      const keys = sent.fields.map((f: { key: string }) => f.key);
      expect(keys).not.toContain("provisionalDiagnosis");
      expect(keys).toContain("icd10Code");
    });

    it("never calls the model when nothing has been confirmed yet", async () => {
      const extract = vi.fn();
      vi.mocked(preauthIntegration.getPreauthExtractor).mockReturnValue({
        extract,
      });
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue(
        claim() as never,
      );
      vi.mocked(preauthRepository.listForClaim).mockResolvedValue([] as never);
      vi.mocked(documentsRepository.listForClaim).mockResolvedValue([
        confirmedDoc({ confirmedAt: null }),
      ] as never);

      const { extractFields } = await import("./preauth.service.js");
      const result = await extractFields(auth(), CLAIM_ID);

      expect(extract).not.toHaveBeenCalled();
      expect(result).toMatchObject({ extracted: 0, documentsRead: 0 });
    });

    it("still extracts when OCR throws", async () => {
      // OCR enhances a suggestion that is itself optional — a Textract
      // outage must not stop the rest working.
      vi.mocked(ocr.canOcr).mockReturnValue(true);
      vi.mocked(ocr.detectText).mockRejectedValue(new Error("textract down"));
      const extract = vi
        .fn()
        .mockResolvedValue({ fields: [], documentsRead: 1 });
      vi.mocked(preauthIntegration.getPreauthExtractor).mockReturnValue({
        extract,
      });
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue(
        claim() as never,
      );
      vi.mocked(preauthRepository.listForClaim).mockResolvedValue([] as never);
      vi.mocked(documentsRepository.listForClaim).mockResolvedValue([
        confirmedDoc(),
      ] as never);
      vi.mocked(preauthRepository.saveSuggestions).mockResolvedValue(
        [] as never,
      );

      const { extractFields } = await import("./preauth.service.js");
      await expect(extractFields(auth(), CLAIM_ID)).resolves.toMatchObject({
        documentsRead: 1,
      });
      expect(extract).toHaveBeenCalled();
    });
  });

  describe("confirmField", () => {
    beforeEach(() => {
      vi.mocked(preauthRepository.confirm).mockResolvedValue({
        fieldKey: "x",
        aiValue: null,
      } as never);
      vi.mocked(preauthRepository.listForClaim).mockResolvedValue([] as never);
      // No placements, so `fieldOnClaim` falls through to the standard
      // catalogue — the path every case below is actually testing.
      vi.mocked(preauthLayoutsService.layoutForClaim).mockResolvedValue({
        sections: [],
      } as never);
    });

    it("rejects a value the field's own type won't take", async () => {
      // The same gate the extractor's answers go through — a human
      // typing by hand doesn't get a looser one.
      const { confirmField, InvalidFieldValueError } =
        await import("./preauth.service.js");
      await expect(
        confirmField(auth(), CLAIM_ID, "totalExpectedCost", "about 2 lakh"),
      ).rejects.toThrow(InvalidFieldValueError);
      expect(preauthRepository.confirm).not.toHaveBeenCalled();
    });

    it("rejects a field that isn't on the form", async () => {
      const { confirmField, UnknownFieldError } =
        await import("./preauth.service.js");
      await expect(
        confirmField(auth(), CLAIM_ID, "madeUpField", "x"),
      ).rejects.toThrow(UnknownFieldError);
    });

    it("stores the canonical form, not what was typed", async () => {
      const { confirmField } = await import("./preauth.service.js");
      await confirmField(auth(), CLAIM_ID, "totalExpectedCost", " 185000 ");
      expect(preauthRepository.confirm).toHaveBeenCalledWith(
        CLAIM_ID,
        "totalExpectedCost",
        "185000.00",
        MEMBER_ID,
      );
    });

    it("leaves the billed amount alone when the expected cost is confirmed", async () => {
      // It used to write this through to claims.billed_amount. Expected
      // cost is what the hospital asked the insurer to cover; billed is
      // what it charged at discharge, and the gap between them is the
      // whole point of the money model (docs/adr/0012). Conflating them
      // made every shortfall compute as zero.
      const { confirmField } = await import("./preauth.service.js");
      await confirmField(auth(), CLAIM_ID, "totalExpectedCost", "185000");
      expect(claimsRepository.updateConfirmedFacts).not.toHaveBeenCalled();
    });

    it("combines a confirmed admission date and time into the claim's timestamp", async () => {
      vi.mocked(preauthRepository.listForClaim).mockResolvedValue([
        { fieldKey: "admissionTime", value: "09:40" },
      ] as never);

      const { confirmField } = await import("./preauth.service.js");
      await confirmField(auth(), CLAIM_ID, "admissionDate", "2026-10-30");

      const call = vi.mocked(claimsRepository.updateConfirmedFacts).mock
        .calls[0]?.[1];
      expect(call?.admittedAt).toEqual(new Date("2026-10-30T09:40:00"));
    });

    it("takes a date with no time as midnight rather than skipping it", async () => {
      const { confirmField } = await import("./preauth.service.js");
      await confirmField(auth(), CLAIM_ID, "admissionDate", "2026-10-30");

      const call = vi.mocked(claimsRepository.updateConfirmedFacts).mock
        .calls[0]?.[1];
      expect(call?.admittedAt).toEqual(new Date("2026-10-30T00:00:00"));
    });

    it("doesn't touch the claim when only the time is known", async () => {
      const { confirmField } = await import("./preauth.service.js");
      await confirmField(auth(), CLAIM_ID, "admissionTime", "09:40");
      expect(claimsRepository.updateConfirmedFacts).not.toHaveBeenCalled();
    });

    it("leaves the claim alone for a field it doesn't mirror", async () => {
      const { confirmField } = await import("./preauth.service.js");
      await confirmField(auth(), CLAIM_ID, "icd10Code", "K81.0");
      expect(claimsRepository.updateConfirmedFacts).not.toHaveBeenCalled();
    });
  });
});

/**
 * The pre-submission review (docs/adr/0015). The combination is what's
 * worth pinning: rules always run, the model is optional in both
 * directions, and a failed clinical read must never read as a clean
 * form.
 */
describe("preauth.service.reviewClaimForm", () => {
  const CLEAN_FIELDS = [
    {
      fieldKey: "treatingDoctorRegistrationNo",
      value: "KMC/12345",
      confirmedAt: new Date(),
    },
    {
      fieldKey: "firstConsultationDate",
      value: "2026-10-25",
      confirmedAt: new Date(),
    },
    { fieldKey: "admissionDate", value: "2026-10-30", confirmedAt: new Date() },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
      id: CLAIM_ID,
      procedureName: "Cholecystectomy",
    } as never);
    vi.mocked(preauthRepository.listForClaim).mockResolvedValue(
      CLEAN_FIELDS as never,
    );
    vi.mocked(auditor.getFormAuditor).mockReturnValue(null);
  });

  it("runs the rules with no model configured, and says the clinical read didn't happen", async () => {
    const { reviewClaimForm } = await import("./preauth.service.js");
    const review = await reviewClaimForm(auth(), CLAIM_ID);

    expect(review.clinicalReviewRan).toBe(false);
    expect(review.findings.every((f) => f.source === "rules")).toBe(true);
  });

  it("finds the rule breaches in a contradictory form", async () => {
    vi.mocked(preauthRepository.listForClaim).mockResolvedValue([
      ...CLEAN_FIELDS,
      {
        fieldKey: "admissionDate",
        value: "2026-10-20",
        confirmedAt: new Date(),
      },
    ] as never);

    const { reviewClaimForm } = await import("./preauth.service.js");
    const review = await reviewClaimForm(auth(), CLAIM_ID);

    expect(review.findings.map((f) => f.code)).toContain(
      "admission_before_consultation",
    );
    expect(review.blockers).toBeGreaterThan(0);
  });

  it("ignores unconfirmed values, which are still only suggestions", async () => {
    vi.mocked(preauthRepository.listForClaim).mockResolvedValue([
      {
        fieldKey: "treatingDoctorRegistrationNo",
        value: "KMC/1",
        confirmedAt: null,
      },
    ] as never);

    const { reviewClaimForm } = await import("./preauth.service.js");
    const review = await reviewClaimForm(auth(), CLAIM_ID);

    // The registration number is unconfirmed, so it reads as missing —
    // and the model is never asked about a form nobody has filled.
    expect(review.findings.map((f) => f.code)).toContain(
      "missing_doctor_registration",
    );
    expect(review.clinicalReviewRan).toBe(false);
  });

  it("merges the model's clinical findings in, with blockers first", async () => {
    vi.mocked(auditor.getFormAuditor).mockReturnValue({
      audit: vi.fn().mockResolvedValue([
        {
          code: "claude_0",
          severity: "blocker",
          fieldKeys: ["provisionalDiagnosis"],
          message: "Diagnosis doesn't match the surgery named.",
          source: "claude",
        },
      ]),
    });

    const { reviewClaimForm } = await import("./preauth.service.js");
    const review = await reviewClaimForm(auth(), CLAIM_ID);

    expect(review.clinicalReviewRan).toBe(true);
    expect(review.findings[0]).toMatchObject({
      severity: "blocker",
      source: "claude",
    });
  });

  it("keeps the rules' findings when the clinical read fails", async () => {
    vi.mocked(auditor.getFormAuditor).mockReturnValue({
      audit: vi.fn().mockRejectedValue(new Error("anthropic down")),
    });
    vi.mocked(preauthRepository.listForClaim).mockResolvedValue([
      { fieldKey: "expectedStayDays", value: "0", confirmedAt: new Date() },
    ] as never);

    const { reviewClaimForm } = await import("./preauth.service.js");
    const review = await reviewClaimForm(auth(), CLAIM_ID);

    expect(review.findings.map((f) => f.code)).toContain("stay_not_positive");
    // And never claims the clinical half ran.
    expect(review.clinicalReviewRan).toBe(false);
  });

  it("passes the claim's procedure to the model for context", async () => {
    const audit = vi.fn().mockResolvedValue([]);
    vi.mocked(auditor.getFormAuditor).mockReturnValue({ audit });

    const { reviewClaimForm } = await import("./preauth.service.js");
    await reviewClaimForm(auth(), CLAIM_ID);

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ procedureName: "Cholecystectomy" }),
    );
  });

  it("raises ClaimNotFoundError for a claim that doesn't exist", async () => {
    vi.mocked(claimsRepository.getClaimById).mockResolvedValue(
      undefined as never,
    );
    const { reviewClaimForm, ClaimNotFoundError } =
      await import("./preauth.service.js");
    await expect(reviewClaimForm(auth(), CLAIM_ID)).rejects.toThrow(
      ClaimNotFoundError,
    );
  });
});
