import { PREAUTH_FIELDS } from "@claimflow/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

const { ClaudePreauthExtractor } = await import("./claude.js");

/**
 * These all exercise the same rule: whatever the model returns is
 * untrusted input. A value that survives validation goes in front of a
 * desk executive as a suggestion on a form a TPA authorises against, so
 * the useful failure mode is dropping a doubtful value, never coercing
 * one into looking right.
 */

function toolUse(fields: unknown) {
  return {
    content: [
      { type: "tool_use", name: "record_preauth_fields", input: { fields } },
    ],
  };
}

const DOC_ID = "11111111-1111-4111-8111-111111111111";

/** A PNG header with real dimensions, padded to the size of an actual scan. */
function pngBytes(width = 1240, height = 1754, size = 64_000): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function input() {
  return {
    fields: PREAUTH_FIELDS,
    patientName: "Meera Joshi",
    procedureName: "Gall bladder removal",
    documents: [
      {
        id: DOC_ID,
        fileName: "scan0091.png",
        contentType: "image/png",
        checklistSlot: "Treating doctor's note",
        readBytes: async () => pngBytes(),
        ocrText: "Provisional diagnosis: acute cholecystitis",
      },
    ],
  };
}

async function extractOne(field: Record<string, unknown>) {
  create.mockResolvedValueOnce(toolUse([field]));
  const outcome = await new ClaudePreauthExtractor("test-key").extract(input());
  return outcome.fields;
}

describe("ClaudePreauthExtractor", () => {
  beforeEach(() => {
    create.mockReset();
  });

  it("keeps a clean extraction and canonicalises the value", async () => {
    const results = await extractOne({
      fieldKey: "totalExpectedCost",
      value: "185000",
      confidence: 0.92,
      sourceSnippet: "Sum total expected cost of hospitalization: 185000",
      sourceDocumentId: DOC_ID,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      fieldKey: "totalExpectedCost",
      value: "185000.00",
      confidence: 0.92,
      sourceDocumentId: DOC_ID,
    });
  });

  it("drops a currency value written out in words", async () => {
    const results = await extractOne({
      fieldKey: "totalExpectedCost",
      value: "approx 1.85 lakh",
      confidence: 0.9,
      sourceSnippet: "roughly one point eight five lakh",
      sourceDocumentId: DOC_ID,
    });
    expect(results).toEqual([]);
  });

  it("drops a field that isn't in the catalogue", async () => {
    const results = await extractOne({
      fieldKey: "patientBloodGroup",
      value: "O+",
      confidence: 0.99,
      sourceSnippet: "Blood group: O+",
      sourceDocumentId: DOC_ID,
    });
    expect(results).toEqual([]);
  });

  it("drops an enum answered in prose rather than with a key", async () => {
    const results = await extractOne({
      fieldKey: "lineOfTreatment",
      value: "Surgical Management",
      confidence: 0.95,
      sourceSnippet: "Proposed line of treatment: surgical",
      sourceDocumentId: DOC_ID,
    });
    expect(results).toEqual([]);
  });

  it("keeps the value but nulls a source document it wasn't given", async () => {
    // Worth keeping: the snippet is still checkable, and losing a good
    // value over a bad provenance id helps nobody.
    const results = await extractOne({
      fieldKey: "provisionalDiagnosis",
      value: "Acute cholecystitis",
      confidence: 0.88,
      sourceSnippet: "diagnosed with acute cholecystitis",
      sourceDocumentId: "99999999-9999-4999-8999-999999999999",
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.sourceDocumentId).toBeNull();
  });

  it("takes the first of two answers for the same field", async () => {
    create.mockResolvedValueOnce(
      toolUse([
        {
          fieldKey: "provisionalDiagnosis",
          value: "Acute cholecystitis",
          confidence: 0.9,
          sourceSnippet: "doctor's note",
          sourceDocumentId: DOC_ID,
        },
        {
          fieldKey: "provisionalDiagnosis",
          value: "Cholelithiasis",
          confidence: 0.7,
          sourceSnippet: "ultrasound report",
          sourceDocumentId: DOC_ID,
        },
      ]),
    );
    const { fields } = await new ClaudePreauthExtractor("k").extract(input());
    expect(fields).toHaveLength(1);
    expect(fields[0]?.value).toBe("Acute cholecystitis");
  });

  it("falls back to a middling confidence when none came back", async () => {
    const results = await extractOne({
      fieldKey: "provisionalDiagnosis",
      value: "Acute cholecystitis",
      confidence: "very sure",
      sourceSnippet: "doctor's note",
      sourceDocumentId: DOC_ID,
    });
    expect(results[0]?.confidence).toBe(0.5);
  });

  it("returns nothing when no document is a type it can read", async () => {
    const { fields: results, documentsRead } = await new ClaudePreauthExtractor(
      "k",
    ).extract({
      ...input(),
      documents: [
        {
          id: DOC_ID,
          fileName: "notes.docx",
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          checklistSlot: "Treating doctor's note",
          readBytes: async () => new Uint8Array(4096),
          ocrText: undefined,
        },
      ],
    });
    expect(results).toEqual([]);
    expect(documentsRead).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("doesn't call the model when every field is already confirmed", async () => {
    const outcome = await new ClaudePreauthExtractor("k").extract({
      ...input(),
      fields: [],
    });
    expect(outcome).toEqual({ fields: [], documentsRead: 0 });
    expect(create).not.toHaveBeenCalled();
  });

  it("survives a reply with no tool call in it", async () => {
    create.mockResolvedValueOnce({
      content: [{ type: "text", text: "I couldn't read these." }],
    });
    const outcome = await new ClaudePreauthExtractor("k").extract(input());
    expect(outcome.fields).toEqual([]);
    // It still read the page — it just didn't come back with anything.
    expect(outcome.documentsRead).toBe(1);
  });

  it("skips a thumbnail-sized scan instead of letting it fail the batch", async () => {
    // A 1x1 placeholder is a valid PNG the API still rejects, and in a
    // batched request that would take every good document with it.
    const tiny = pngBytes(1, 1, 2048);

    const outcome = await new ClaudePreauthExtractor("k").extract({
      ...input(),
      documents: [
        {
          id: DOC_ID,
          fileName: "placeholder.png",
          contentType: "image/png",
          checklistSlot: "Photo ID proof",
          readBytes: async () => tiny,
          ocrText: undefined,
        },
      ],
    });
    expect(outcome).toEqual({ fields: [], documentsRead: 0 });
    expect(create).not.toHaveBeenCalled();
  });

  it("reports how many documents it actually read", async () => {
    create.mockResolvedValueOnce(toolUse([]));
    const outcome = await new ClaudePreauthExtractor("k").extract({
      ...input(),
      documents: [
        ...input().documents,
        {
          id: "22222222-2222-4222-8222-222222222222",
          fileName: "notes.txt",
          contentType: "text/plain",
          checklistSlot: "Previous treatment records",
          readBytes: async () => new Uint8Array(4096),
          ocrText: undefined,
        },
      ],
    });
    // Two offered, one readable.
    expect(outcome.documentsRead).toBe(1);
  });

  it("sends the OCR text alongside the image, not instead of it", async () => {
    create.mockResolvedValueOnce(toolUse([]));
    await new ClaudePreauthExtractor("k").extract(input());

    const content = create.mock.calls[0]?.[0]?.messages?.[0]?.content as {
      type: string;
      text?: string;
    }[];
    expect(content.some((b) => b.type === "image")).toBe(true);
    expect(content.some((b) => b.text?.includes("acute cholecystitis"))).toBe(
      true,
    );
  });
});
