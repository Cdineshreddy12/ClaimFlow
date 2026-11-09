import { beforeEach, describe, expect, it, vi } from "vitest";
import * as documentsRepository from "./documents.repository.js";
import * as s3 from "../../integrations/storage/s3.js";
import * as orgMembersRepository from "../members/members.repository.js";
import * as claimsRepository from "../claims/claims.repository.js";
import * as classifier from "../../integrations/classifier/index.js";

vi.mock("./documents.repository.js");
vi.mock("../../integrations/storage/s3.js");
vi.mock("../members/members.repository.js");
vi.mock("../claims/claims.repository.js");
vi.mock("../../integrations/classifier/index.js");
vi.mock("../../integrations/ocr/textract.js");
vi.mock("../audit/audit.service.js");

const USER_ID = "22222222-2222-2222-2222-222222222222";
const CLAIM_ID = "33333333-3333-3333-3333-333333333333";
const DOCUMENT_ID = "44444444-4444-4444-4444-444444444444";
const MEMBER_ID = "55555555-5555-5555-5555-555555555555";

function auth() {
  return { userId: USER_ID };
}

describe("documents.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listDocuments", () => {
    it("raises ClaimNotFoundError when the repository returns undefined (wrong org)", async () => {
      vi.mocked(documentsRepository.listForClaim).mockResolvedValue(undefined);

      const { listDocuments, ClaimNotFoundError } =
        await import("./documents.service.js");

      await expect(listDocuments(auth(), CLAIM_ID)).rejects.toThrow(
        ClaimNotFoundError,
      );
    });
  });

  describe("requestUploadUrl", () => {
    it("builds an org/claim-scoped key and asks S3 for a pre-signed PUT url", async () => {
      vi.mocked(s3.buildObjectKey).mockReturnValue(
        "organizations/x/claims/y/key.pdf",
      );
      vi.mocked(s3.getUploadUrl).mockResolvedValue(
        "https://s3.example/signed-put",
      );

      const { requestUploadUrl } = await import("./documents.service.js");
      const result = await requestUploadUrl(auth(), CLAIM_ID, {
        fileName: "report.pdf",
        contentType: "application/pdf",
        sizeBytes: 1_200_000,
      });

      expect(s3.buildObjectKey).toHaveBeenCalledWith(CLAIM_ID, "report.pdf");
      // The size reaches S3, where it is signed into the URL as the
      // only Content-Length that link will accept.
      expect(s3.getUploadUrl).toHaveBeenCalledWith(
        "organizations/x/claims/y/key.pdf",
        "application/pdf",
        1_200_000,
      );
      expect(result).toEqual({
        uploadUrl: "https://s3.example/signed-put",
        key: "organizations/x/claims/y/key.pdf",
      });
    });
  });

  describe("confirmDocument", () => {
    it("resolves the caller's org-member id and passes it through as confirmedBy", async () => {
      vi.mocked(orgMembersRepository.getMemberId).mockResolvedValue(MEMBER_ID);
      vi.mocked(documentsRepository.confirm).mockResolvedValue({
        id: DOCUMENT_ID,
        checklistSlot: "Pre-authorization form",
      } as never);

      const { confirmDocument } = await import("./documents.service.js");
      await confirmDocument(
        auth(),
        CLAIM_ID,
        DOCUMENT_ID,
        "Pre-authorization form",
      );

      expect(documentsRepository.confirm).toHaveBeenCalledWith(
        CLAIM_ID,
        DOCUMENT_ID,
        "Pre-authorization form",
        MEMBER_ID,
      );
    });

    it("raises DocumentNotFoundError when nothing matched", async () => {
      vi.mocked(orgMembersRepository.getMemberId).mockResolvedValue(MEMBER_ID);
      vi.mocked(documentsRepository.confirm).mockResolvedValue(undefined);

      const { confirmDocument, DocumentNotFoundError } =
        await import("./documents.service.js");

      await expect(
        confirmDocument(
          auth(),
          CLAIM_ID,
          DOCUMENT_ID,
          "Pre-authorization form",
        ),
      ).rejects.toThrow(DocumentNotFoundError);
    });
  });

  describe("discardDocument", () => {
    it("deletes the S3 object only after the DB row is confirmed to exist and removed", async () => {
      vi.mocked(documentsRepository.getById).mockResolvedValue({
        id: DOCUMENT_ID,
        fileUrl: "organizations/x/doc.pdf",
      } as never);

      const { discardDocument } = await import("./documents.service.js");
      await discardDocument(auth(), CLAIM_ID, DOCUMENT_ID);

      expect(documentsRepository.remove).toHaveBeenCalledWith(
        CLAIM_ID,
        DOCUMENT_ID,
      );
      expect(s3.deleteObject).toHaveBeenCalledWith("organizations/x/doc.pdf");
    });

    it("never calls S3 if the document doesn't exist", async () => {
      vi.mocked(documentsRepository.getById).mockResolvedValue(undefined);

      const { discardDocument, DocumentNotFoundError } =
        await import("./documents.service.js");

      await expect(
        discardDocument(auth(), CLAIM_ID, DOCUMENT_ID),
      ).rejects.toThrow(DocumentNotFoundError);
      expect(s3.deleteObject).not.toHaveBeenCalled();
    });
  });

  /**
   * A classification answers "which of these slots", and the list moves
   * underneath it: a cost estimate was read against six slots, refused
   * them all correctly, and the next day the claim gained a "Cost
   * estimate" slot. Re-reading is how that answer catches up.
   */
  describe("reclassifyDocument", () => {
    it("reads the file again against the checklist as it stands now", async () => {
      vi.mocked(documentsRepository.getById).mockResolvedValue({
        id: DOCUMENT_ID,
        fileUrl: "claims/x/estimate_sheet.png",
        confirmedAt: null,
      } as never);
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        checklistSnapshot: [
          { documentType: "Photo ID proof" },
          { documentType: "Cost estimate" },
        ],
      } as never);
      vi.mocked(s3.getObjectBytes).mockResolvedValue(new Uint8Array([1]));
      const classify = vi.fn().mockResolvedValue({
        slot: "Cost estimate",
        confidence: 0.94,
        reason: "Headed ESTIMATED COST OF HOSPITALISATION.",
        classifiedBy: "claude",
      });
      vi.mocked(classifier.getClassifier).mockReturnValue({ classify });
      vi.mocked(documentsRepository.saveClassification).mockResolvedValue({
        id: DOCUMENT_ID,
        aiClassifiedType: "Cost estimate",
      } as never);

      const { reclassifyDocument } = await import("./documents.service.js");
      await reclassifyDocument(auth(), CLAIM_ID, DOCUMENT_ID);

      // The slot added since the first read is on the list this time.
      expect(classify).toHaveBeenCalledWith(
        expect.objectContaining({
          candidateSlots: ["Photo ID proof", "Cost estimate"],
          // Derived from the key, because the upload stored no content type.
          contentType: "image/png",
        }),
      );
      expect(documentsRepository.saveClassification).toHaveBeenCalledWith(
        DOCUMENT_ID,
        expect.objectContaining({ slot: "Cost estimate" }),
      );
    });

    it("refuses a document that is already filed", async () => {
      vi.mocked(documentsRepository.getById).mockResolvedValue({
        id: DOCUMENT_ID,
        fileUrl: "claims/x/estimate_sheet.png",
        confirmedAt: "2026-11-05T12:00:00.000Z",
      } as never);

      const { reclassifyDocument, DocumentAlreadyFiledError } =
        await import("./documents.service.js");

      // Re-reading a filed document would replace the evidence a human
      // actually acted on with a fresh opinion of the same page.
      await expect(
        reclassifyDocument(auth(), CLAIM_ID, DOCUMENT_ID),
      ).rejects.toThrow(DocumentAlreadyFiledError);
      expect(documentsRepository.saveClassification).not.toHaveBeenCalled();
    });

    it("raises when the classifier can't read the file", async () => {
      vi.mocked(documentsRepository.getById).mockResolvedValue({
        id: DOCUMENT_ID,
        fileUrl: "claims/x/blank.png",
        confirmedAt: null,
      } as never);
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        checklistSnapshot: [{ documentType: "Photo ID proof" }],
      } as never);
      vi.mocked(s3.getObjectBytes).mockResolvedValue(new Uint8Array([1]));
      vi.mocked(classifier.getClassifier).mockReturnValue({
        // What the Anthropic API actually does with a 146-byte
        // placeholder PNG: 400, "Could not process image".
        classify: vi.fn().mockRejectedValue(new Error("Could not process")),
      });

      const { reclassifyDocument, DocumentUnreadableError } =
        await import("./documents.service.js");

      // The upload path swallows this on purpose — the file is stored
      // and a human can pick a slot. Here somebody pressed a button and
      // is owed an answer.
      await expect(
        reclassifyDocument(auth(), CLAIM_ID, DOCUMENT_ID),
      ).rejects.toThrow(DocumentUnreadableError);
    });

    it("raises when the document isn't there", async () => {
      vi.mocked(documentsRepository.getById).mockResolvedValue(undefined);

      const { reclassifyDocument, DocumentNotFoundError } =
        await import("./documents.service.js");

      await expect(
        reclassifyDocument(auth(), CLAIM_ID, DOCUMENT_ID),
      ).rejects.toThrow(DocumentNotFoundError);
    });
  });
});
