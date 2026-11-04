import { beforeEach, describe, expect, it, vi } from "vitest";
import * as repo from "./doctor-approval.repository.js";
import * as documentsRepository from "../documents/documents.repository.js";
import * as auditService from "../audit/audit.service.js";
import { getDownloadUrl } from "../../integrations/storage/s3.js";

vi.mock("./doctor-approval.repository.js");
vi.mock("../documents/documents.repository.js");
vi.mock("../audit/audit.service.js");
vi.mock("../org-members/org-members.repository.js");
vi.mock("../../integrations/storage/s3.js");

const TOKEN = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "22222222-2222-2222-2222-222222222222";
const CLAIM_ID = "33333333-3333-3333-3333-333333333333";

function row(approvalOverrides: Record<string, unknown> = {}) {
  return {
    approval: {
      id: "approval-1",
      doctorName: "Dr Mehta",
      expiresAt: new Date(Date.now() + 60_000),
      firstViewedAt: null,
      approvedAt: null,
      declinedAt: null,
      ...approvalOverrides,
    },
    claimId: CLAIM_ID,
    organizationId: ORG_ID,
    patientName: "Rajendra Pawar",
    procedureName: "Gall bladder removal",
    insurerName: "Company B",
    hospitalName: "City General Hospital",
  };
}

function doc(slot: string, confirmed = true) {
  return {
    id: `doc-${slot}`,
    checklistSlot: slot,
    confirmedAt: confirmed ? new Date() : null,
    fileUrl: `key/${slot}`,
  };
}

describe("doctor-approval.service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getDownloadUrl).mockResolvedValue("https://signed.example/doc");
    vi.mocked(documentsRepository.listForClaim).mockResolvedValue([] as never);
  });

  describe("viewByToken", () => {
    it("rejects an unknown token", async () => {
      vi.mocked(repo.getByTokenWithContext).mockResolvedValue(undefined);
      const { viewByToken, LinkNotFoundError } =
        await import("./doctor-approval.service.js");
      await expect(viewByToken(TOKEN)).rejects.toThrow(LinkNotFoundError);
    });

    it("rejects an expired link", async () => {
      vi.mocked(repo.getByTokenWithContext).mockResolvedValue(
        row({ expiresAt: new Date(Date.now() - 1000) }) as never,
      );
      const { viewByToken, LinkExpiredError } =
        await import("./doctor-approval.service.js");
      await expect(viewByToken(TOKEN)).rejects.toThrow(LinkExpiredError);
    });

    it("rejects a link that was already decided", async () => {
      vi.mocked(repo.getByTokenWithContext).mockResolvedValue(
        row({ approvedAt: new Date() }) as never,
      );
      const { viewByToken, LinkAlreadyDecidedError } =
        await import("./doctor-approval.service.js");
      await expect(viewByToken(TOKEN)).rejects.toThrow(LinkAlreadyDecidedError);
    });

    it("exposes only confirmed clinical documents, not every file on the claim", async () => {
      vi.mocked(repo.getByTokenWithContext).mockResolvedValue(row() as never);
      vi.mocked(documentsRepository.listForClaim).mockResolvedValue([
        doc("Treating doctor's note"),
        doc("Ultrasound report (abdomen)"),
        doc("Photo ID proof"), // administrative — not the doctor's business
        doc("Policy / e-card copy"), // ditto
        doc("Discharge summary", false), // unconfirmed — not vouched for yet
      ] as never);

      const { viewByToken } = await import("./doctor-approval.service.js");
      const view = await viewByToken(TOKEN);

      expect(view.documents.map((d) => d.slot)).toEqual([
        "Treating doctor's note",
        "Ultrasound report (abdomen)",
      ]);
    });

    it("never returns billing or claim-reference detail to a link holder", async () => {
      vi.mocked(repo.getByTokenWithContext).mockResolvedValue(row() as never);
      const { viewByToken } = await import("./doctor-approval.service.js");
      const view = await viewByToken(TOKEN);

      expect(view).not.toHaveProperty("billedAmount");
      expect(view).not.toHaveProperty("claimId");
      expect(view.patientName).toBe("Rajendra Pawar");
    });

    it("stamps and audits the first view only", async () => {
      vi.mocked(repo.getByTokenWithContext).mockResolvedValue(row() as never);
      const { viewByToken } = await import("./doctor-approval.service.js");
      await viewByToken(TOKEN);

      expect(repo.markFirstViewed).toHaveBeenCalledWith("approval-1");
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG_ID }),
        expect.objectContaining({
          action: "doctor_approval.viewed",
          actorId: null,
        }),
      );
    });

    it("does not re-stamp firstViewedAt when reopened", async () => {
      vi.mocked(repo.getByTokenWithContext).mockResolvedValue(
        row({ firstViewedAt: new Date(Date.now() - 5000) }) as never,
      );
      const { viewByToken } = await import("./doctor-approval.service.js");
      await viewByToken(TOKEN);

      expect(repo.markFirstViewed).not.toHaveBeenCalled();
    });
  });

  describe("decide", () => {
    it("records an approval and audits it with no org_member actor", async () => {
      vi.mocked(repo.getByTokenWithContext).mockResolvedValue(row() as never);
      vi.mocked(repo.recordDecision).mockResolvedValue({} as never);

      const { decide } = await import("./doctor-approval.service.js");
      await decide(TOKEN, { approved: true });

      expect(repo.recordDecision).toHaveBeenCalledWith("approval-1", {
        approved: true,
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "doctor_approval.approved",
          actorId: null,
        }),
      );
    });

    it("carries the decline reason into the audit entry", async () => {
      vi.mocked(repo.getByTokenWithContext).mockResolvedValue(row() as never);
      vi.mocked(repo.recordDecision).mockResolvedValue({} as never);

      const { decide } = await import("./doctor-approval.service.js");
      await decide(TOKEN, { approved: false, reason: "Platelet count stale" });

      expect(auditService.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "doctor_approval.declined",
          after: expect.objectContaining({ reason: "Platelet count stale" }),
        }),
      );
    });

    it("refuses a second decision on the same link", async () => {
      vi.mocked(repo.getByTokenWithContext).mockResolvedValue(
        row({ declinedAt: new Date() }) as never,
      );
      const { decide, LinkAlreadyDecidedError } =
        await import("./doctor-approval.service.js");
      await expect(decide(TOKEN, { approved: true })).rejects.toThrow(
        LinkAlreadyDecidedError,
      );
      expect(repo.recordDecision).not.toHaveBeenCalled();
    });
  });
});
