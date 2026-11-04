import { beforeEach, describe, expect, it, vi } from "vitest";
import * as queriesRepository from "./queries.repository.js";
import * as orgMembersRepository from "../members/members.repository.js";
import * as summariser from "../../integrations/summariser/claude.js";

vi.mock("./queries.repository.js");
vi.mock("../members/members.repository.js");
vi.mock("../../integrations/summariser/claude.js");
vi.mock("../audit/audit.service.js");

const USER_ID = "22222222-2222-2222-2222-222222222222";
const CLAIM_ID = "33333333-3333-3333-3333-333333333333";
const QUERY_ID = "44444444-4444-4444-4444-444444444444";
const MEMBER_ID = "55555555-5555-5555-5555-555555555555";

function auth(role: "desk_executive" | "desk_head") {
  return { userId: USER_ID, role };
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

  /**
   * The summariser only ever fills a blank. Someone who typed their own
   * summary has read the email, and a model overwriting that is it
   * second-guessing the one human who was actually there — so every
   * test here is about what the service declines to touch.
   */
  describe("createQuery summarisation", () => {
    const SUMMARY = "Star Health wants the doctor's note before authorising.";

    function summariserReturning(result: Partial<summariser.QuerySummary>) {
      const summarise = vi.fn().mockResolvedValue({
        summary: SUMMARY,
        requestedItems: ["Treating doctor's note"],
        deadline: "2026-11-06T09:15:00.000Z",
        deadlineInferred: true,
        ...result,
      });
      vi.mocked(summariser.getSummariser).mockReturnValue({ summarise });
      return summarise;
    }

    /** Whatever the service decided to insert. */
    function inserted() {
      return vi.mocked(queriesRepository.create).mock.calls[0]![1];
    }

    beforeEach(() => {
      vi.mocked(queriesRepository.create).mockResolvedValue({
        id: QUERY_ID,
      } as never);
    });

    it("fills a blank summary, items and deadline, and marks them as derived", async () => {
      const summarise = summariserReturning({});

      const { createQuery } = await import("./queries.service.js");
      await createQuery(auth("desk_head"), CLAIM_ID, {
        tpaRawEmail: "Please revert within 48 hours.",
        requestedItems: [],
      });

      expect(summarise).toHaveBeenCalledWith({
        rawEmail: "Please revert within 48 hours.",
        receivedAt: expect.any(Date),
      });
      expect(inserted()).toMatchObject({
        aiSummary: SUMMARY,
        requestedItems: ["Treating doctor's note"],
        deadline: new Date("2026-11-06T09:15:00.000Z"),
        summarisedBy: "claude",
        deadlineInferred: true,
      });
    });

    it("leaves a summary the desk typed alone, and doesn't label it as the model's", async () => {
      summariserReturning({});

      const { createQuery } = await import("./queries.service.js");
      await createQuery(auth("desk_head"), CLAIM_ID, {
        tpaRawEmail: "...",
        aiSummary: "They want the note. Already chased radiology.",
        requestedItems: [],
      });

      const data = inserted();
      expect(data.aiSummary).toBe(
        "They want the note. Already chased radiology.",
      );
      expect(data.summarisedBy).toBeUndefined();
      // Still fills the fields that were left blank.
      expect(data.requestedItems).toEqual(["Treating doctor's note"]);
    });

    it("leaves a deadline the desk typed alone, and doesn't flag it as calculated", async () => {
      summariserReturning({});
      const typed = new Date("2026-11-10T00:00:00.000Z");

      const { createQuery } = await import("./queries.service.js");
      await createQuery(auth("desk_head"), CLAIM_ID, {
        tpaRawEmail: "...",
        requestedItems: [],
        deadline: typed,
      });

      const data = inserted();
      expect(data.deadline).toBe(typed);
      expect(data.deadlineInferred).toBeUndefined();
    });

    it("doesn't call the model at all when the desk filled everything in", async () => {
      const summarise = summariserReturning({});

      const { createQuery } = await import("./queries.service.js");
      await createQuery(auth("desk_head"), CLAIM_ID, {
        tpaRawEmail: "...",
        aiSummary: "Handled.",
        requestedItems: ["Final itemised bill"],
        deadline: new Date("2026-11-10T00:00:00.000Z"),
      });

      expect(summarise).not.toHaveBeenCalled();
    });

    it("stores the query unchanged when no key is configured", async () => {
      vi.mocked(summariser.getSummariser).mockReturnValue(null);

      const { createQuery } = await import("./queries.service.js");
      await createQuery(auth("desk_head"), CLAIM_ID, {
        tpaRawEmail: "...",
        requestedItems: [],
      });

      const data = inserted();
      expect(data.aiSummary).toBeUndefined();
      expect(data.summarisedBy).toBeUndefined();
    });

    it("keeps the pasted email when the model fails rather than losing the create", async () => {
      vi.mocked(summariser.getSummariser).mockReturnValue({
        summarise: vi.fn().mockRejectedValue(new Error("anthropic down")),
      });

      const { createQuery } = await import("./queries.service.js");
      const created = await createQuery(auth("desk_head"), CLAIM_ID, {
        tpaRawEmail: "Please revert within 48 hours.",
        requestedItems: [],
      });

      expect(created.id).toBe(QUERY_ID);
      expect(inserted()).toMatchObject({
        tpaRawEmail: "Please revert within 48 hours.",
      });
      expect(inserted().summarisedBy).toBeUndefined();
    });

    it("leaves the deadline blank when the email gave none", async () => {
      summariserReturning({ deadline: null, deadlineInferred: false });

      const { createQuery } = await import("./queries.service.js");
      await createQuery(auth("desk_head"), CLAIM_ID, {
        tpaRawEmail: "...",
        requestedItems: [],
      });

      const data = inserted();
      expect(data.deadline).toBeUndefined();
      expect(data.deadlineInferred).toBeUndefined();
      // The summary still landed.
      expect(data.summarisedBy).toBe("claude");
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

      expect(queriesRepository.markReplied).toHaveBeenCalledWith(QUERY_ID);
      expect(result.replySentAt).not.toBeNull();
    });
  });

  describe("listInbox", () => {
    it("desk_executive is forced to their own assigned claims' queries", async () => {
      vi.mocked(orgMembersRepository.getMemberId).mockResolvedValue(MEMBER_ID);
      vi.mocked(queriesRepository.listInbox).mockResolvedValue([]);

      const { listInbox } = await import("./queries.service.js");
      await listInbox(auth("desk_executive"), { status: "open" });

      expect(queriesRepository.listInbox).toHaveBeenCalledWith({
        status: "open",
        assignedTo: MEMBER_ID,
      });
    });

    it("desk_head sees the whole inbox, no assignedTo filter", async () => {
      vi.mocked(queriesRepository.listInbox).mockResolvedValue([]);

      const { listInbox } = await import("./queries.service.js");
      await listInbox(auth("desk_head"), { status: "open" });

      expect(queriesRepository.listInbox).toHaveBeenCalledWith({
        status: "open",
      });
      expect(orgMembersRepository.getMemberId).not.toHaveBeenCalled();
    });
  });
});
