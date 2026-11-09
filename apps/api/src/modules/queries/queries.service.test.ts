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
        sentAt: expect.any(Date),
      });
      expect(inserted()).toMatchObject({
        aiSummary: SUMMARY,
        requestedItems: ["Treating doctor's note"],
        deadline: new Date("2026-11-06T09:15:00.000Z"),
        summarisedBy: "claude",
        deadlineInferred: true,
      });
    });

    it("counts the reply window from the email's own Date header", async () => {
      // The whole point of the feature is beating a TAT. Anchoring
      // "within 48 hours" to the paste rather than the send hands the
      // desk hours it does not have — four on an email opened the same
      // afternoon, a full day on one found the next morning.
      const summarise = summariserReturning({});

      const { createQuery } = await import("./queries.service.js");
      await createQuery(auth("desk_head"), CLAIM_ID, {
        tpaRawEmail: [
          "From: preauth@tpa.in",
          "Date: Thu, 6 Nov 2026 11:42:18 +0530",
          "",
          "Kindly revert within 48 hours.",
        ].join("\n"),
        requestedItems: [],
      });

      expect(summarise.mock.calls[0]![0].sentAt.toISOString()).toBe(
        "2026-11-06T06:12:18.000Z",
      );
    });

    it("falls back to now when the paste carries no header", async () => {
      // Only the body was pasted. The email is presumably fresh, and
      // inventing a send time would be worse than assuming one.
      const summarise = summariserReturning({});

      const { createQuery } = await import("./queries.service.js");
      await createQuery(auth("desk_head"), CLAIM_ID, {
        tpaRawEmail: "Kindly revert within 48 hours.",
        requestedItems: [],
      });

      const sentAt: Date = summarise.mock.calls[0]![0].sentAt;
      expect(Date.now() - sentAt.getTime()).toBeLessThan(5_000);
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

    it("leaves a derived deadline unconfirmed — it's the model's reading, not a human's", async () => {
      summariserReturning({});

      const { createQuery } = await import("./queries.service.js");
      await createQuery(auth("desk_head"), CLAIM_ID, {
        tpaRawEmail: "Please revert within 48 hours.",
        requestedItems: [],
      });

      const data = inserted();
      expect(data.deadline).toEqual(new Date("2026-11-06T09:15:00.000Z"));
      expect(data.deadlineConfirmedAt).toBeUndefined();
      expect(data.deadlineConfirmedBy).toBeUndefined();
      expect(orgMembersRepository.getMemberId).not.toHaveBeenCalled();
    });

    it("counts a deadline the desk typed as confirmed by whoever typed it", async () => {
      summariserReturning({});
      vi.mocked(orgMembersRepository.getMemberId).mockResolvedValue(MEMBER_ID);

      const { createQuery } = await import("./queries.service.js");
      await createQuery(auth("desk_head"), CLAIM_ID, {
        tpaRawEmail: "...",
        requestedItems: [],
        deadline: new Date("2026-11-10T00:00:00.000Z"),
      });

      const data = inserted();
      expect(data.deadlineConfirmedBy).toBe(MEMBER_ID);
      expect(data.deadlineConfirmedAt).toEqual(expect.any(Date));
    });
  });

  /**
   * The gate docs/adr/0005 asks for on the one summariser output that
   * lands in a live column instead of a suggestion one.
   */
  describe("confirmDeadline", () => {
    beforeEach(() => {
      vi.mocked(orgMembersRepository.getMemberId).mockResolvedValue(MEMBER_ID);
      vi.mocked(queriesRepository.getById).mockResolvedValue({
        id: QUERY_ID,
        deadline: new Date("2026-11-06T09:15:00.000Z"),
        deadlineInferred: true,
      } as never);
      vi.mocked(queriesRepository.confirmDeadline).mockResolvedValue({
        id: QUERY_ID,
        deadline: new Date("2026-11-06T09:15:00.000Z"),
        deadlineConfirmedAt: new Date(),
      } as never);
    });

    it("stamps the member against the stored date when no override is sent", async () => {
      const { confirmDeadline } = await import("./queries.service.js");
      const result = await confirmDeadline(
        auth("desk_executive"),
        QUERY_ID,
        {},
      );

      // undefined, not the echoed value: confirming as-is must not be
      // able to rewrite a deadline that moved since the inbox loaded.
      expect(queriesRepository.confirmDeadline).toHaveBeenCalledWith(
        QUERY_ID,
        undefined,
        MEMBER_ID,
      );
      expect(result.deadlineConfirmedAt).not.toBeNull();
    });

    it("passes an override through, including the null that clears a wrong one", async () => {
      const { confirmDeadline } = await import("./queries.service.js");
      await confirmDeadline(auth("desk_head"), QUERY_ID, { deadline: null });

      expect(queriesRepository.confirmDeadline).toHaveBeenCalledWith(
        QUERY_ID,
        null,
        MEMBER_ID,
      );
    });

    it("raises QueryNotFoundError rather than confirming a deadline on nothing", async () => {
      vi.mocked(queriesRepository.getById).mockResolvedValue(undefined);

      const { confirmDeadline, QueryNotFoundError } =
        await import("./queries.service.js");

      await expect(
        confirmDeadline(auth("desk_head"), QUERY_ID, {}),
      ).rejects.toThrow(QueryNotFoundError);
      expect(queriesRepository.confirmDeadline).not.toHaveBeenCalled();
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

    it("updateQuery carries the editor through, so a hand-typed deadline lands confirmed", async () => {
      vi.mocked(orgMembersRepository.getMemberId).mockResolvedValue(MEMBER_ID);
      vi.mocked(queriesRepository.update).mockResolvedValue({
        id: QUERY_ID,
      } as never);
      const deadline = new Date("2026-11-12T12:00:00.000Z");

      const { updateQuery } = await import("./queries.service.js");
      await updateQuery(auth("desk_head"), QUERY_ID, { deadline });

      expect(queriesRepository.update).toHaveBeenCalledWith(
        QUERY_ID,
        { deadline },
        MEMBER_ID,
      );
    });

    it("updateQuery doesn't go looking up a member for an edit that isn't a deadline", async () => {
      vi.mocked(queriesRepository.update).mockResolvedValue({
        id: QUERY_ID,
      } as never);

      const { updateQuery } = await import("./queries.service.js");
      await updateQuery(auth("desk_head"), QUERY_ID, {
        aiSummary: "Rewritten.",
      });

      expect(orgMembersRepository.getMemberId).not.toHaveBeenCalled();
      expect(queriesRepository.update).toHaveBeenCalledWith(
        QUERY_ID,
        { aiSummary: "Rewritten." },
        null,
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
  /**
   * A failed call and a query nobody ran the model on used to look
   * identical from the outside — both left the summary null. The
   * status is what lets the panel offer a retry on one and not the
   * other, so what it records matters more than what it is called.
   */
  describe("createQuery records what the summariser did", () => {
    beforeEach(() => {
      vi.mocked(queriesRepository.create).mockResolvedValue({
        id: QUERY_ID,
      } as never);
    });

    it("marks a summarised query ok", async () => {
      vi.mocked(summariser.getSummariser).mockReturnValue({
        summarise: vi.fn().mockResolvedValue({
          summary: "They want the discharge summary.",
          requestedItems: ["Discharge summary"],
          deadline: null,
          deadlineInferred: false,
        }),
      });

      const { createQuery } = await import("./queries.service.js");
      await createQuery(auth("desk_head"), CLAIM_ID, {
        tpaRawEmail: "Send the discharge summary.",
        requestedItems: [],
      });

      expect(
        vi.mocked(queriesRepository.create).mock.calls[0]![1]
          .summarisationStatus,
      ).toBe("ok");
    });

    it("still saves the query when the model falls over, and says so", async () => {
      vi.mocked(summariser.getSummariser).mockReturnValue({
        summarise: vi.fn().mockRejectedValue(new Error("502 from upstream")),
      });

      const { createQuery } = await import("./queries.service.js");
      await createQuery(auth("desk_head"), CLAIM_ID, {
        tpaRawEmail: "Send the discharge summary.",
        requestedItems: [],
      });

      const written = vi.mocked(queriesRepository.create).mock.calls[0]![1];
      // The paste is what matters; losing it to a model outage would be
      // the worse failure by far.
      expect(written.tpaRawEmail).toBe("Send the discharge summary.");
      expect(written.summarisationStatus).toBe("failed");
      expect(written.aiSummary).toBeUndefined();
    });

    it("leaves a query the desk filled in itself as not_attempted", async () => {
      vi.mocked(summariser.getSummariser).mockReturnValue({
        summarise: vi.fn(),
      });

      const { createQuery } = await import("./queries.service.js");
      await createQuery(auth("desk_head"), CLAIM_ID, {
        tpaRawEmail: "...",
        aiSummary: "They want the bill.",
        requestedItems: ["Final bill"],
        deadline: new Date("2026-11-10T10:00:00.000Z"),
      });

      expect(
        vi.mocked(queriesRepository.create).mock.calls[0]![1]
          .summarisationStatus,
      ).toBeUndefined();
    });
  });

  /**
   * The summariser runs inside the create, so a slow model can outlast
   * the client's timeout: the desk sees "couldn't save", presses the
   * button again, and the row that did commit gets a twin that sits in
   * the inbox being counted overdue alongside it.
   */
  describe("createQuery duplicate suppression", () => {
    it("returns the row the first attempt stored instead of a second one", async () => {
      const already = { id: QUERY_ID, aiSummary: "Already read." };
      vi.mocked(queriesRepository.findRecentDuplicate).mockResolvedValue(
        already as never,
      );

      const { createQuery } = await import("./queries.service.js");
      const result = await createQuery(auth("desk_head"), CLAIM_ID, {
        tpaRawEmail: "Send the discharge summary.",
        requestedItems: [],
      });

      expect(result).toBe(already);
      expect(queriesRepository.create).not.toHaveBeenCalled();
    });

    it("checks before paying for the model, not after", async () => {
      vi.mocked(queriesRepository.findRecentDuplicate).mockResolvedValue({
        id: QUERY_ID,
      } as never);
      const summarise = vi.fn();
      vi.mocked(summariser.getSummariser).mockReturnValue({ summarise });

      const { createQuery } = await import("./queries.service.js");
      await createQuery(auth("desk_head"), CLAIM_ID, {
        tpaRawEmail: "Send the discharge summary.",
        requestedItems: [],
      });

      expect(summarise).not.toHaveBeenCalled();
    });
  });

  describe("resummarise", () => {
    const EMAIL = "Kindly send the Part B form within 48 hours.";

    function storedQuery(over: Record<string, unknown> = {}) {
      return {
        id: QUERY_ID,
        tpaRawEmail: EMAIL,
        aiSummary: null,
        requestedItems: [],
        deadline: null,
        summarisationStatus: "failed",
        ...over,
      } as never;
    }

    it("fills what is still blank and marks the query ok", async () => {
      vi.mocked(queriesRepository.getById).mockResolvedValue(storedQuery());
      vi.mocked(queriesRepository.saveSummarisation).mockResolvedValue({
        id: QUERY_ID,
      } as never);
      vi.mocked(summariser.getSummariser).mockReturnValue({
        summarise: vi.fn().mockResolvedValue({
          summary: "They want the Part B form.",
          requestedItems: ["Signed Part B form"],
          deadline: "2026-11-08T03:30:00.000Z",
          deadlineInferred: true,
        }),
      });

      const { resummarise } = await import("./queries.service.js");
      await resummarise(auth("desk_head"), QUERY_ID);

      expect(queriesRepository.saveSummarisation).toHaveBeenCalledWith(
        QUERY_ID,
        expect.objectContaining({
          summarisationStatus: "ok",
          aiSummary: "They want the Part B form.",
          requestedItems: ["Signed Part B form"],
          deadlineInferred: true,
        }),
      );
    });

    it("keeps a summary the desk wrote after giving up on the model", async () => {
      vi.mocked(queriesRepository.getById).mockResolvedValue(
        storedQuery({ aiSummary: "Typed this myself." }),
      );
      vi.mocked(queriesRepository.saveSummarisation).mockResolvedValue({
        id: QUERY_ID,
      } as never);
      vi.mocked(summariser.getSummariser).mockReturnValue({
        summarise: vi.fn().mockResolvedValue({
          summary: "The model's version.",
          requestedItems: ["Signed Part B form"],
          deadline: null,
          deadlineInferred: false,
        }),
      });

      const { resummarise } = await import("./queries.service.js");
      await resummarise(auth("desk_head"), QUERY_ID);

      const patch = vi.mocked(queriesRepository.saveSummarisation).mock
        .calls[0]![1];
      expect(patch.aiSummary).toBeUndefined();
      // The items were still blank, so those it may fill.
      expect(patch.requestedItems).toEqual(["Signed Part B form"]);
    });

    it("leaves the query retryable when the retry fails too", async () => {
      vi.mocked(queriesRepository.getById).mockResolvedValue(storedQuery());
      vi.mocked(queriesRepository.saveSummarisation).mockResolvedValue({
        id: QUERY_ID,
      } as never);
      vi.mocked(summariser.getSummariser).mockReturnValue({
        summarise: vi.fn().mockRejectedValue(new Error("still down")),
      });

      const { resummarise, SummarisationFailedError } =
        await import("./queries.service.js");

      await expect(resummarise(auth("desk_head"), QUERY_ID)).rejects.toThrow(
        SummarisationFailedError,
      );
      expect(queriesRepository.saveSummarisation).toHaveBeenCalledWith(
        QUERY_ID,
        { summarisationStatus: "failed" },
      );
    });

    it("refuses a query with no email to read", async () => {
      vi.mocked(queriesRepository.getById).mockResolvedValue(
        storedQuery({ tpaRawEmail: null }),
      );

      const { resummarise, NothingToSummariseError } =
        await import("./queries.service.js");

      await expect(resummarise(auth("desk_head"), QUERY_ID)).rejects.toThrow(
        NothingToSummariseError,
      );
    });

    it("refuses when no summariser is configured, rather than marking it failed", async () => {
      vi.mocked(queriesRepository.getById).mockResolvedValue(storedQuery());
      vi.mocked(summariser.getSummariser).mockReturnValue(null);

      const { resummarise, SummariserUnavailableError } =
        await import("./queries.service.js");

      await expect(resummarise(auth("desk_head"), QUERY_ID)).rejects.toThrow(
        SummariserUnavailableError,
      );
      // Nothing was attempted, so nothing is recorded about an attempt.
      expect(queriesRepository.saveSummarisation).not.toHaveBeenCalled();
    });
  });
});
