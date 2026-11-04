import { beforeEach, describe, expect, it, vi } from "vitest";
import * as claimsRepository from "./claims.repository.js";

vi.mock("./claims.repository.js");

// vi.mock factories are hoisted above all other module code, so this
// can't reference an outer const — the literal has to live inline here.
vi.mock("../../db/client.js", () => {
  const where = vi
    .fn()
    .mockResolvedValue([{ id: "22222222-2222-2222-2222-222222222222" }]);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { db: { select } };
});

const MEMBER_ID = "22222222-2222-2222-2222-222222222222";
const ORG_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "33333333-3333-3333-3333-333333333333";
const CLAIM_ID = "44444444-4444-4444-4444-444444444444";

function auth(role: "desk_executive" | "desk_head") {
  return { userId: USER_ID, organizationId: ORG_ID, role };
}

describe("claims.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listClaims", () => {
    it("desk_executive is forced to their own assigned claims, even if scope=all was asked for", async () => {
      vi.mocked(claimsRepository.listClaims).mockResolvedValue([]);

      await import("./claims.service.js").then((m) =>
        m.listClaims(auth("desk_executive"), { scope: "all" }),
      );

      expect(claimsRepository.listClaims).toHaveBeenCalledWith(
        ORG_ID,
        expect.objectContaining({ assignedTo: MEMBER_ID }),
      );
    });

    it("desk_head gets the whole org by default", async () => {
      vi.mocked(claimsRepository.listClaims).mockResolvedValue([]);

      await import("./claims.service.js").then((m) =>
        m.listClaims(auth("desk_head"), { scope: "all" }),
      );

      expect(claimsRepository.listClaims).toHaveBeenCalledWith(
        ORG_ID,
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
        ORG_ID,
        CLAIM_ID,
        "QUERY_RAISED",
        MEMBER_ID,
        undefined,
      );
    });
  });
});
