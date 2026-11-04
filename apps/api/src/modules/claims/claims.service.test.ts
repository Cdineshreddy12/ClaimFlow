import { beforeEach, describe, expect, it, vi } from "vitest";
import * as claimsRepository from "./claims.repository.js";
import * as checklistService from "../checklist/checklist.service.js";
import * as documentsRepository from "../documents/documents.repository.js";
import * as orgMembersRepository from "../members/members.repository.js";

vi.mock("./claims.repository.js");
vi.mock("../checklist/checklist.service.js");
vi.mock("../documents/documents.repository.js");
vi.mock("../members/members.repository.js");

const MEMBER_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "33333333-3333-3333-3333-333333333333";
const CLAIM_ID = "44444444-4444-4444-4444-444444444444";

function auth(role: "desk_executive" | "desk_head") {
  return { userId: USER_ID, role };
}

describe("claims.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(orgMembersRepository.getMemberId).mockResolvedValue(MEMBER_ID);
  });

  describe("listClaims", () => {
    it("desk_executive is forced to their own assigned claims, even if scope=all was asked for", async () => {
      vi.mocked(claimsRepository.listClaims).mockResolvedValue([]);

      await import("./claims.service.js").then((m) =>
        m.listClaims(auth("desk_executive"), { scope: "all" }),
      );

      expect(claimsRepository.listClaims).toHaveBeenCalledWith(
        expect.objectContaining({ assignedTo: MEMBER_ID }),
      );
    });

    it("desk_head gets the whole org by default", async () => {
      vi.mocked(claimsRepository.listClaims).mockResolvedValue([]);

      await import("./claims.service.js").then((m) =>
        m.listClaims(auth("desk_head"), { scope: "all" }),
      );

      expect(claimsRepository.listClaims).toHaveBeenCalledWith(
        expect.not.objectContaining({ assignedTo: expect.anything() }),
      );
    });
  });

  describe("getClaim", () => {
    it("desk_executive gets a not-found error for a claim assigned to someone else", async () => {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        assignedTo: "someone-else",
      } as never);

      const { getClaim, ClaimNotFoundError } =
        await import("./claims.service.js");

      await expect(getClaim(auth("desk_executive"), CLAIM_ID)).rejects.toThrow(
        ClaimNotFoundError,
      );
    });

    it("desk_executive can read a claim assigned to them", async () => {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        assignedTo: MEMBER_ID,
      } as never);

      const { getClaim } = await import("./claims.service.js");
      const claim = await getClaim(auth("desk_executive"), CLAIM_ID);
      expect(claim.id).toBe(CLAIM_ID);
    });
  });

  describe("createClaim", () => {
    it("snapshots the current checklist requirements onto the new claim", async () => {
      const INSURER_ID = "55555555-5555-5555-5555-555555555555";
      const PROCEDURE_ID = "66666666-6666-6666-6666-666666666666";
      const snapshot = [
        { documentType: "Pre-authorization form", required: true },
      ];

      vi.mocked(checklistService.getRequirementsSnapshot).mockResolvedValue(
        snapshot,
      );
      vi.mocked(claimsRepository.createClaim).mockResolvedValue({
        id: CLAIM_ID,
      } as never);

      const { createClaim } = await import("./claims.service.js");
      await createClaim(auth("desk_executive"), {
        patientName: "Rajendra Pawar",
        insurerId: INSURER_ID,
        procedureId: PROCEDURE_ID,
      });

      expect(checklistService.getRequirementsSnapshot).toHaveBeenCalledWith(
        INSURER_ID,
        PROCEDURE_ID,
      );
      expect(claimsRepository.createClaim).toHaveBeenCalledWith(
        expect.objectContaining({ patientName: "Rajendra Pawar" }),
        snapshot,
      );
    });
  });

  describe("getClaimGaps", () => {
    it("splits the checklist snapshot into missing vs satisfied by confirmed document slots", async () => {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        assignedTo: MEMBER_ID,
        checklistSnapshot: [
          { documentType: "Pre-authorization form", required: true },
          { documentType: "Ultrasound report (abdomen)", required: true },
          { documentType: "Previous treatment records", required: false },
        ],
      } as never);
      vi.mocked(documentsRepository.confirmedSlotsForClaim).mockResolvedValue([
        "Pre-authorization form",
      ]);

      const { getClaimGaps } = await import("./claims.service.js");
      const result = await getClaimGaps(auth("desk_executive"), CLAIM_ID);

      expect(result.missing).toEqual(["Ultrasound report (abdomen)"]);
      expect(result.satisfied).toEqual(["Pre-authorization form"]);
    });

    it("never lists an optional document as missing", async () => {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        assignedTo: MEMBER_ID,
        checklistSnapshot: [
          { documentType: "Previous treatment records", required: false },
        ],
      } as never);
      vi.mocked(documentsRepository.confirmedSlotsForClaim).mockResolvedValue(
        [],
      );

      const { getClaimGaps } = await import("./claims.service.js");
      const result = await getClaimGaps(auth("desk_executive"), CLAIM_ID);

      expect(result.missing).toEqual([]);
    });
  });

  describe("transitionClaimStatus", () => {
    it("rejects a transition the state machine doesn't allow", async () => {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        status: "DRAFT",
      } as never);

      const { transitionClaimStatus, InvalidTransitionError } =
        await import("./claims.service.js");

      await expect(
        transitionClaimStatus(
          auth("desk_head"),
          CLAIM_ID,
          "APPROVED",
          undefined,
        ),
      ).rejects.toThrow(InvalidTransitionError);
      expect(claimsRepository.recordStatusChange).not.toHaveBeenCalled();
    });

    it("rejects settling a claim when the actor isn't desk_head", async () => {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        status: "FINAL_BILL_SUBMITTED",
      } as never);

      const { transitionClaimStatus, InvalidTransitionError } =
        await import("./claims.service.js");

      await expect(
        transitionClaimStatus(
          auth("desk_executive"),
          CLAIM_ID,
          "SETTLED",
          undefined,
        ),
      ).rejects.toThrow(InvalidTransitionError);
    });

    it("allows a legal transition and records it with the resolved org-member id", async () => {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        status: "PRE_AUTH_SENT",
      } as never);
      vi.mocked(claimsRepository.recordStatusChange).mockResolvedValue({
        id: CLAIM_ID,
        status: "QUERY_RAISED",
      } as never);

      const { transitionClaimStatus } = await import("./claims.service.js");
      const result = await transitionClaimStatus(
        auth("desk_executive"),
        CLAIM_ID,
        "QUERY_RAISED",
        undefined,
      );

      expect(result.status).toBe("QUERY_RAISED");
      expect(claimsRepository.recordStatusChange).toHaveBeenCalledWith(
        CLAIM_ID,
        "QUERY_RAISED",
        MEMBER_ID,
        undefined,
      );
    });
  });
});
