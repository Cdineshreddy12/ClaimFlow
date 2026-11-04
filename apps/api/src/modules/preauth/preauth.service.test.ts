import { beforeEach, describe, expect, it, vi } from "vitest";
import * as claimsRepository from "../claims/claims.repository.js";
import * as documentsRepository from "../documents/documents.repository.js";
import * as orgMembersRepository from "../org-members/org-members.repository.js";
import * as preauthIntegration from "../../integrations/preauth/index.js";
import * as ocr from "../../integrations/ocr/textract.js";
import * as s3 from "../../integrations/storage/s3.js";
import * as preauthRepository from "./preauth.repository.js";

vi.mock("./preauth.repository.js");
vi.mock("../claims/claims.repository.js");
vi.mock("../documents/documents.repository.js");
vi.mock("../org-members/org-members.repository.js");
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
    vi.mocked(orgMembersRepository.getOrgMemberId).mockResolvedValue(MEMBER_ID);
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
        ORG_ID,
        CLAIM_ID,
        "totalExpectedCost",
        "185000.00",
        MEMBER_ID,
      );
    });

    it("writes a confirmed total back onto the claim", async () => {
      const { confirmField } = await import("./preauth.service.js");
      await confirmField(auth(), CLAIM_ID, "totalExpectedCost", "185000");
      expect(claimsRepository.updateConfirmedFacts).toHaveBeenCalledWith(
        ORG_ID,
        CLAIM_ID,
        { billedAmount: "185000.00" },
      );
    });

    it("combines a confirmed admission date and time into the claim's timestamp", async () => {
      vi.mocked(preauthRepository.listForClaim).mockResolvedValue([
        { fieldKey: "admissionTime", value: "09:40" },
      ] as never);

      const { confirmField } = await import("./preauth.service.js");
      await confirmField(auth(), CLAIM_ID, "admissionDate", "2026-10-30");

      const call = vi.mocked(claimsRepository.updateConfirmedFacts).mock
        .calls[0]?.[2];
      expect(call?.admittedAt).toEqual(new Date("2026-10-30T09:40:00"));
    });

    it("takes a date with no time as midnight rather than skipping it", async () => {
      const { confirmField } = await import("./preauth.service.js");
      await confirmField(auth(), CLAIM_ID, "admissionDate", "2026-10-30");

      const call = vi.mocked(claimsRepository.updateConfirmedFacts).mock
        .calls[0]?.[2];
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
