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

    it("still records the request when the claim can't legally move", async () => {
      // An APPROVED claim can still need more money. Losing the request
      // because the status machine won't budge would lose the fact that
      // matters most.
      vi.mocked(claimsRepository.recordStatusChange).mockRejectedValue(
        new Error("illegal transition"),
      );

      const { requestEnhancement } = await import("./enhancements.service.js");
      const created = await requestEnhancement(auth, CLAIM_ID, {
        requestedAmount: 80_000,
        reason: "Sepsis, extended stay",
      });

      expect(created.id).toBe(ENH_ID);
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
