import { beforeEach, describe, expect, it, vi } from "vitest";
import * as repo from "./enhancements.repository.js";
import * as claimsRepository from "../claims/claims.repository.js";
import { getMemberId } from "../members/members.repository.js";

vi.mock("./enhancements.repository.js");
vi.mock("../claims/claims.repository.js");
vi.mock("../members/members.repository.js");
vi.mock("../audit/audit.service.js");

const USER_ID = "22222222-2222-2222-2222-222222222222";
const CLAIM_ID = "33333333-3333-3333-3333-333333333333";
const ENH_ID = "88888888-8888-8888-8888-888888888888";
const MEMBER_ID = "55555555-5555-5555-5555-555555555555";

const auth = { userId: USER_ID, role: "desk_head" as const };

describe("enhancements.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMemberId).mockResolvedValue(MEMBER_ID);
    vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
      id: CLAIM_ID,
      status: "PRE_AUTH_SENT",
    } as never);
    vi.mocked(repo.getOpenForClaim).mockResolvedValue(undefined as never);
    vi.mocked(repo.create).mockResolvedValue({
      id: ENH_ID,
      claimId: CLAIM_ID,
      slaDeadline: new Date("2026-11-04T10:00:00.000Z"),
    } as never);
    vi.mocked(claimsRepository.recordStatusChange).mockResolvedValue(
      {} as never,
    );
  });

  describe("requestEnhancement", () => {
    it("stamps its own SLA deadline rather than trusting a caller", async () => {
      const { requestEnhancement } = await import("./enhancements.service.js");
      await requestEnhancement(auth, CLAIM_ID, {
        requestedAmount: 80_000,
        reason: "Converted to open surgery",
      });

      const [, data] = vi.mocked(repo.create).mock.calls[0]!;
      expect(data.slaDeadline).toBeInstanceOf(Date);
      // One hour out, per the enhancement window in contracts.
      expect(data.slaDeadline!.getTime() - Date.now()).toBeGreaterThan(
        55 * 60_000,
      );
      expect(data.slaDeadline!.getTime() - Date.now()).toBeLessThan(
        65 * 60_000,
      );
    });

    it("moves the claim to say an enhancement is pending", async () => {
      const { requestEnhancement } = await import("./enhancements.service.js");
      await requestEnhancement(auth, CLAIM_ID, {
        requestedAmount: 80_000,
        reason: "Two extra ICU days",
      });

      expect(claimsRepository.recordStatusChange).toHaveBeenCalledWith(
        CLAIM_ID,
        "ENHANCEMENT_REQUESTED",
        MEMBER_ID,
        expect.any(Date),
        // The status canTransition was asked about, so the write
        // refuses if the claim has moved since.
        "PRE_AUTH_SENT",
      );
    });

    it("refuses a second open request rather than giving the TPA two to choose from", async () => {
      vi.mocked(repo.getOpenForClaim).mockResolvedValue({
        id: "other",
        requestedAmount: "50000.00",
      } as never);

      const { requestEnhancement, EnhancementAlreadyOpenError } =
        await import("./enhancements.service.js");
      await expect(
        requestEnhancement(auth, CLAIM_ID, {
          requestedAmount: 80_000,
          reason: "x",
        }),
      ).rejects.toThrow(EnhancementAlreadyOpenError);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("moves an approved claim, which is when the overrun usually shows up", async () => {
      // The sanction is agreed on admission; the patient deteriorates
      // mid-stay. This used to be forbidden by the transition table and
      // happen anyway, because the status was written straight to the
      // repository without consulting it.
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        status: "APPROVED",
      } as never);

      const { requestEnhancement } = await import("./enhancements.service.js");
      await requestEnhancement(auth, CLAIM_ID, {
        requestedAmount: 80_000,
        reason: "Sepsis, extended stay",
      });

      expect(claimsRepository.recordStatusChange).toHaveBeenCalledWith(
        CLAIM_ID,
        "ENHANCEMENT_REQUESTED",
        MEMBER_ID,
        expect.any(Date),
        "APPROVED",
      );
    });

    it("records the request without moving a claim that can't legally move", async () => {
      // A settled claim can still have an enhancement recorded against
      // it for the history. Losing that record would lose the fact that
      // matters most — but neither does it get to drag a closed claim
      // back open behind the state machine's back.
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        status: "SETTLED",
      } as never);

      const { requestEnhancement } = await import("./enhancements.service.js");
      const created = await requestEnhancement(auth, CLAIM_ID, {
        requestedAmount: 80_000,
        reason: "Late claim from the insurer",
      });

      expect(created.id).toBe(ENH_ID);
      expect(claimsRepository.recordStatusChange).not.toHaveBeenCalled();
    });

    it("raises ClaimNotFoundError for a claim that doesn't exist", async () => {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue(
        undefined as never,
      );

      const { requestEnhancement, ClaimNotFoundError } =
        await import("./enhancements.service.js");
      await expect(
        requestEnhancement(auth, CLAIM_ID, {
          requestedAmount: 1,
          reason: "x",
        }),
      ).rejects.toThrow(ClaimNotFoundError);
    });
  });

  describe("decideEnhancement", () => {
    beforeEach(() => {
      vi.mocked(repo.getById).mockResolvedValue({
        id: ENH_ID,
        claimId: CLAIM_ID,
        status: "REQUESTED",
      } as never);
      vi.mocked(repo.decide).mockResolvedValue({
        id: ENH_ID,
        status: "PARTIALLY_APPROVED",
      } as never);
    });

    it("passes the granted amount through to the repository", async () => {
      const { decideEnhancement } = await import("./enhancements.service.js");
      await decideEnhancement(auth, ENH_ID, {
        outcome: "PARTIALLY_APPROVED",
        approvedAmount: 50_000,
      });

      expect(repo.decide).toHaveBeenCalledWith(
        ENH_ID,
        "PARTIALLY_APPROVED",
        50_000,
      );
    });

    it("never decides the same enhancement twice", async () => {
      // The granted amount has already been added to the claim's
      // ceiling; deciding again would add it a second time.
      vi.mocked(repo.getById).mockResolvedValue({
        id: ENH_ID,
        claimId: CLAIM_ID,
        status: "APPROVED",
      } as never);

      const { decideEnhancement, EnhancementAlreadyDecidedError } =
        await import("./enhancements.service.js");
      await expect(
        decideEnhancement(auth, ENH_ID, {
          outcome: "APPROVED",
          approvedAmount: 10_000,
        }),
      ).rejects.toThrow(EnhancementAlreadyDecidedError);
      expect(repo.decide).not.toHaveBeenCalled();
    });

    it("raises EnhancementNotFoundError for an unknown id", async () => {
      vi.mocked(repo.getById).mockResolvedValue(undefined as never);

      const { decideEnhancement, EnhancementNotFoundError } =
        await import("./enhancements.service.js");
      await expect(
        decideEnhancement(auth, ENH_ID, { outcome: "REJECTED" }),
      ).rejects.toThrow(EnhancementNotFoundError);
    });
  });
});
