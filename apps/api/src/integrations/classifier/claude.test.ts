import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

const { ClaudeClassifier } = await import("./claude.js");

/**
 * What the classifier refuses.
 *
 * A desk dropped a company logo and a screenshot in alongside the
 * scans, and both came back filed into checklist slots — the logo as a
 * pre-authorisation form. Forced tool use means the model always
 * answers; asked only "which of these slots", it picks one. So the
 * refusal has to be a field it fills in, and this is the test that it
 * is honoured whatever else came back in the same call.
 *
 * Filing a stray image into a slot is worse than leaving it loose: the
 * slot then reads as answered and the document it was waiting for
 * never gets chased.
 */

const SLOTS = [
  "Pre-authorization form",
  "Photo ID proof",
  "Ultrasound report (abdomen)",
];

function classifyWith(input: unknown) {
  create.mockResolvedValueOnce({
    content: [{ type: "tool_use", name: "record_classification", input }],
  });
  return new ClaudeClassifier("test-key").classify({
    fileName: "alumni-lockup.png",
    contentType: "image/png",
    candidateSlots: SLOTS,
    readBytes: async () => new Uint8Array([1, 2, 3]),
  });
}

beforeEach(() => {
  create.mockReset();
});

describe("ClaudeClassifier", () => {
  it("drops the slot when the file isn't a claim document", async () => {
    const result = await classifyWith({
      slot: "Pre-authorization form",
      confidence: 0.82,
      reason: "A logo on a white background.",
      is_claim_document: false,
    });

    expect(result.slot).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("says so in the reason, so the desk knows why nothing was suggested", async () => {
    const result = await classifyWith({
      slot: "Photo ID proof",
      confidence: 0.9,
      reason: "A logo on a white background.",
      is_claim_document: false,
    });

    expect(result.reason).toContain("Doesn't look like a claim document");
    // The model's own description survives — "a logo" is what lets a
    // desk recognise the file they dropped by mistake.
    expect(result.reason).toContain("logo");
  });

  it("keeps a slot that a genuine claim document was matched to", async () => {
    const result = await classifyWith({
      slot: "Ultrasound report (abdomen)",
      confidence: 0.91,
      reason: "Headed ULTRASOUND ABDOMEN & PELVIS.",
      is_claim_document: true,
    });

    expect(result.slot).toBe("Ultrasound report (abdomen)");
    expect(result.confidence).toBeCloseTo(0.91);
  });

  it("still refuses a slot that isn't on this claim's checklist", async () => {
    const result = await classifyWith({
      slot: "Discharge summary",
      confidence: 0.95,
      reason: "Headed DISCHARGE SUMMARY.",
      is_claim_document: true,
    });

    expect(result.slot).toBeNull();
  });
});
