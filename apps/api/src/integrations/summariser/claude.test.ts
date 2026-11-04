import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

const { ClaudeSummariser, getSummariser, setSummariserForTesting } =
  await import("./claude.js");

/**
 * The summary is a convenience and the email is the record (adr 0005),
 * so the rule these exercise is that a doubtful derivation gets dropped
 * rather than dressed up. A missing summary costs the desk a read of an
 * email they have in front of them; a deadline invented out of prose
 * costs them the claim.
 */

const RECEIVED_AT = new Date("2026-11-04T09:15:00.000Z");

const EMAIL = [
  "Dear Provider,",
  "",
  "With reference to pre-auth request PA/2026/55128 for Meera Joshi,",
  "we require the treating doctor's note and the final itemised bill",
  "before we can process the cashless authorisation. Please revert",
  "within 48 hours.",
  "",
  "Regards, Star Health TPA",
].join("\n");

function toolUse(input: unknown) {
  return {
    content: [{ type: "tool_use", name: "record_query_summary", input }],
  };
}

async function summariseOne(input: unknown, rawEmail = EMAIL) {
  create.mockResolvedValueOnce(toolUse(input));
  return new ClaudeSummariser("test-key").summarise({
    rawEmail,
    receivedAt: RECEIVED_AT,
  });
}

describe("ClaudeSummariser", () => {
  beforeEach(() => {
    create.mockReset();
  });

  it("keeps a clean summary, its requested items and its deadline", async () => {
    const result = await summariseOne({
      summary:
        "Star Health wants the treating doctor's note and the final itemised bill before authorising PA/2026/55128.",
      requested_items: ["Treating doctor's note", "Final itemised bill"],
      deadline_iso: "2026-11-06T09:15:00.000Z",
      deadline_was_relative: true,
    });

    expect(result).toEqual({
      summary:
        "Star Health wants the treating doctor's note and the final itemised bill before authorising PA/2026/55128.",
      requestedItems: ["Treating doctor's note", "Final itemised bill"],
      deadline: "2026-11-06T09:15:00.000Z",
      deadlineInferred: true,
    });
  });

  it("forces the tool call and tells the model when the email arrived", async () => {
    await summariseOne({
      summary: "Documents requested.",
      requested_items: [],
      deadline_iso: null,
      deadline_was_relative: false,
    });

    const request = create.mock.calls[0]![0];
    expect(request.tool_choice).toEqual({
      type: "tool",
      name: "record_query_summary",
    });
    expect(request.messages[0].content).toContain(RECEIVED_AT.toISOString());
    expect(request.messages[0].content).toContain("within 48 hours");
  });

  it("throws when the model answers in prose instead of calling the tool", async () => {
    create.mockResolvedValueOnce({
      content: [{ type: "text", text: "They want the doctor's note." }],
    });

    await expect(
      new ClaudeSummariser("test-key").summarise({
        rawEmail: EMAIL,
        receivedAt: RECEIVED_AT,
      }),
    ).rejects.toThrow("no structured output");
  });

  it("drops a deadline that isn't a date, rather than inserting Invalid Date", async () => {
    const result = await summariseOne({
      summary: "Documents requested.",
      requested_items: ["Final itemised bill"],
      deadline_iso: "within 48 hours",
      deadline_was_relative: true,
    });

    expect(result.deadline).toBeNull();
    expect(result.deadlineInferred).toBe(false);
  });

  it("canonicalises a valid but loosely written deadline to ISO", async () => {
    const result = await summariseOne({
      summary: "Documents requested.",
      requested_items: [],
      deadline_iso: "2026-11-06 14:30:00Z",
      deadline_was_relative: false,
    });

    expect(result.deadline).toBe("2026-11-06T14:30:00.000Z");
    expect(result.deadlineInferred).toBe(false);
  });

  it("is not 'inferred' when there is no deadline to have inferred", async () => {
    const result = await summariseOne({
      summary: "Acknowledgement only, nothing requested.",
      requested_items: [],
      deadline_iso: null,
      deadline_was_relative: true,
    });

    expect(result.deadline).toBeNull();
    expect(result.deadlineInferred).toBe(false);
  });

  it("drops blank and non-string requested items", async () => {
    const result = await summariseOne({
      summary: "Documents requested.",
      requested_items: [
        "Treating doctor's note",
        "   ",
        "",
        42,
        null,
        "Final itemised bill",
      ],
      deadline_iso: null,
      deadline_was_relative: false,
    });

    expect(result.requestedItems).toEqual([
      "Treating doctor's note",
      "Final itemised bill",
    ]);
  });

  it("returns no requested items when the model sends something that isn't a list", async () => {
    const result = await summariseOne({
      summary: "Documents requested.",
      requested_items: "Treating doctor's note",
      deadline_iso: null,
      deadline_was_relative: false,
    });

    expect(result.requestedItems).toEqual([]);
  });

  it("truncates a pasted thread so one email can't run up an unbounded bill", async () => {
    const thread = "x".repeat(50_000);
    await summariseOne(
      {
        summary: "Long thread.",
        requested_items: [],
        deadline_iso: null,
        deadline_was_relative: false,
      },
      thread,
    );

    const content = create.mock.calls[0]![0].messages[0].content as string;
    expect(content).toContain("x".repeat(20_000));
    expect(content).not.toContain("x".repeat(20_001));
  });
});

describe("getSummariser", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    setSummariserForTesting(undefined);
  });

  afterEach(() => {
    setSummariserForTesting(undefined);
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("is null without a key — there is no useful non-model fallback here", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(getSummariser()).toBeNull();
  });

  it("builds one summariser and reuses it", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const first = getSummariser();
    expect(first).toBeInstanceOf(ClaudeSummariser);
    expect(getSummariser()).toBe(first);
  });
});
