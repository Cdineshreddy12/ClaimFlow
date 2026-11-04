import { beforeEach, describe, expect, it, vi } from "vitest";
import * as documentsRepository from "./documents.repository.js";
import * as s3 from "../../integrations/storage/s3.js";
import * as orgMembersRepository from "../members/members.repository.js";

vi.mock("./documents.repository.js");
vi.mock("../../integrations/storage/s3.js");
vi.mock("../members/members.repository.js");

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
      });

      expect(s3.buildObjectKey).toHaveBeenCalledWith(CLAIM_ID, "report.pdf");
      expect(s3.getUploadUrl).toHaveBeenCalledWith(
        "organizations/x/claims/y/key.pdf",
        "application/pdf",
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
});
