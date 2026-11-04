import { beforeEach, describe, expect, it, vi } from "vitest";
import * as queriesRepository from "./queries.repository.js";
import * as orgMembersRepository from "../org-members/org-members.repository.js";

vi.mock("./queries.repository.js");
vi.mock("../org-members/org-members.repository.js");

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const CLAIM_ID = "33333333-3333-3333-3333-333333333333";
const QUERY_ID = "44444444-4444-4444-4444-444444444444";
const MEMBER_ID = "55555555-5555-5555-5555-555555555555";

function auth(role: "desk_executive" | "desk_head") {
  return { userId: USER_ID, organizationId: ORG_ID, role };
}

describe("queries.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createQuery / listForClaim", () => {
    it("raises ClaimNotFoundError when the claim belongs to a different organization", async () => {
      vi.mocked(queriesRepository.create).mockResolvedValue(undefined);

      const { createQuery, ClaimNotFoundError } =
        await import("./queries.service.js");

      await expect(
        createQuery(auth("desk_head"), CLAIM_ID, {
          tpaRawEmail: "...",
          requestedItems: [],
        }),
      ).rejects.toThrow(ClaimNotFoundError);
    });
  });

  describe("getQuery / updateQuery / markReplied", () => {
    it("raises QueryNotFoundError when nothing matched the org-scoped lookup", async () => {
      vi.mocked(queriesRepository.getById).mockResolvedValue(undefined);

      const { getQuery, QueryNotFoundError } =
        await import("./queries.service.js");

      await expect(getQuery(auth("desk_head"), QUERY_ID)).rejects.toThrow(
        QueryNotFoundError,
      );
    });

    it("markReplied stamps replySentAt through the repository, not the service", async () => {
      vi.mocked(queriesRepository.markReplied).mockResolvedValue({
        id: QUERY_ID,
        replySentAt: new Date(),
      } as never);

      const { markReplied } = await import("./queries.service.js");
      const result = await markReplied(auth("desk_head"), QUERY_ID);

      expect(queriesRepository.markReplied).toHaveBeenCalledWith(
        ORG_ID,
        QUERY_ID,
      );
      expect(result.replySentAt).not.toBeNull();
    });
  });

  describe("listInbox", () => {
    it("desk_executive is forced to their own assigned claims' queries", async () => {
      vi.mocked(orgMembersRepository.getOrgMemberId).mockResolvedValue(
        MEMBER_ID,
      );
      vi.mocked(queriesRepository.listInbox).mockResolvedValue([]);

      const { listInbox } = await import("./queries.service.js");
      await listInbox(auth("desk_executive"), { status: "open" });

      expect(queriesRepository.listInbox).toHaveBeenCalledWith(ORG_ID, {
        status: "open",
        assignedTo: MEMBER_ID,
      });
    });

    it("desk_head sees the whole org's inbox, no assignedTo filter", async () => {
      vi.mocked(queriesRepository.listInbox).mockResolvedValue([]);

      const { listInbox } = await import("./queries.service.js");
      await listInbox(auth("desk_head"), { status: "open" });

      expect(queriesRepository.listInbox).toHaveBeenCalledWith(ORG_ID, {
        status: "open",
      });
      expect(orgMembersRepository.getOrgMemberId).not.toHaveBeenCalled();
    });
  });
});
