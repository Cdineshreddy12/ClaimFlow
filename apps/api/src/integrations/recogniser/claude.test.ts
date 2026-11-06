import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

const { ClaudeRecogniser } = await import("./claude.js");

/**
 * What the recogniser refuses.
 *
 * This is the first of the two gates and the more important one: a
 * file that never matches a claim never reaches the classifier, and
 * never becomes a filing proposal. Matching a stray image to a real
 * patient is the error this whole path is arranged to avoid.
 */

const CANDIDATES = [
  {
    id: "claim-1",
    reference: "CLM-0001",
    patientName: "Sunita Pawar",
    procedureName: "Laparoscopic cholecystectomy",
    insurerName: "Star Health",
    status: "PRE_AUTH_SENT",
  },
];

function recogniseWith(input: unknown) {
  create.mockResolvedValueOnce({
    content: [{ type: "tool_use", name: "record_recognition", input }],
  });
  return new ClaudeRecogniser("test-key").recognise({
    fileName: "alumni-lockup.png",
    contentType: "image/png",
    readBytes: async () => new Uint8Array([1, 2, 3]),
    candidates: CANDIDATES,
  });
}

beforeEach(() => {
  create.mockReset();
});

describe("ClaudeRecogniser", () => {
  it("matches no claim when the file isn't a claim document", async () => {
    const result = await recogniseWith({
      claim_reference: "CLM-0001",
      confidence: 0.74,
      reason: "Only open claim on the list.",
      document_kind: "company logo",
      is_claim_document: false,
    });

    expect(result.claimId).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("names what the file appears to be instead", async () => {
    const result = await recogniseWith({
      claim_reference: null,
      confidence: 0,
      reason: "Nothing on the page identifies a patient.",
      document_kind: "company logo",
      is_claim_document: false,
    });

    expect(result.reason).toBe(
      "Doesn't look like a claim document — it appears to be a company logo.",
    );
    expect(result.documentKind).toBe("company logo");
  });

  it("matches normally when it is a claim document", async () => {
    const result = await recogniseWith({
      claim_reference: "CLM-0001",
      confidence: 0.93,
      reason: 'Headed "Sunita Pawar, UHID 44812".',
      document_kind: "ultrasound report",
      is_claim_document: true,
    });

    expect(result.claimId).toBe("claim-1");
    expect(result.confidence).toBeCloseTo(0.93);
  });

  it("still refuses a claim reference that wasn't on the list", async () => {
    const result = await recogniseWith({
      claim_reference: "CLM-9999",
      confidence: 0.99,
      reason: "Says CLM-9999 on it.",
      document_kind: "discharge summary",
      is_claim_document: true,
    });

    expect(result.claimId).toBeNull();
  });
});
