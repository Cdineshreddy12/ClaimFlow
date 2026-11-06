import Anthropic from "@anthropic-ai/sdk";
import type { DocumentClassification } from "@claimflow/contracts";
import type { ClassificationInput, DocumentClassifier } from "./types.js";

/**
 * Reads the document itself and picks a checklist slot.
 *
 * Unlike the heuristic this looks at content, which is the point — a
 * scan named `IMG_0423.jpg` is unclassifiable by filename but obvious to
 * anything that can read it, and the brief's hardest case (handwritten
 * doctors' notes) is exactly that.
 *
 * Still a suggestion. It returns a source snippet as its reason so the
 * desk can see what it read before confirming, per docs/adr/0005 —
 * nothing here places a document, it only proposes.
 */

const MODEL = "claude-sonnet-5";

/** Anthropic rejects oversized inline attachments; skip rather than fail the upload. */
const MAX_INLINE_BYTES = 4 * 1024 * 1024;

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: "record_classification",
  description:
    "Record which checklist slot this document belongs in, or that none fits.",
  input_schema: {
    type: "object",
    properties: {
      slot: {
        type: ["string", "null"],
        description:
          "Exactly one of the provided checklist slots, copied verbatim. Null if none fits.",
      },
      confidence: {
        type: "number",
        description: "0 to 1. Below 0.6 means a guess worth double-checking.",
      },
      reason: {
        type: "string",
        description:
          "A short quote or description of what in the document identifies it. This is shown to desk staff.",
      },
      is_claim_document: {
        type: "boolean",
        description:
          "False if this is not a hospital or insurance document at all — a logo, a screenshot, a photo of a person or a place, a slide, an invoice from an unrelated business. Judge the page itself, never the filename.",
      },
    },
    required: ["slot", "confidence", "reason", "is_claim_document"],
  },
};

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function imageMediaType(contentType: string): ImageMediaType | null {
  switch (contentType) {
    case "image/jpeg":
    case "image/jpg":
      return "image/jpeg";
    case "image/png":
      return "image/png";
    case "image/gif":
      return "image/gif";
    case "image/webp":
      return "image/webp";
    default:
      return null;
  }
}

export class ClaudeClassifier implements DocumentClassifier {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async classify(input: ClassificationInput): Promise<DocumentClassification> {
    const bytes = await input.readBytes();

    if (bytes.byteLength > MAX_INLINE_BYTES) {
      return {
        slot: null,
        confidence: 0,
        reason: "File is too large to read automatically — please pick a slot.",
        classifiedBy: "claude",
      };
    }

    const media = imageMediaType(input.contentType);
    const isPdf = input.contentType === "application/pdf";
    if (!media && !isPdf) {
      return {
        slot: null,
        confidence: 0,
        reason: `Can't read ${input.contentType} automatically — please pick a slot.`,
        classifiedBy: "claude",
      };
    }

    const attachment: Anthropic.ContentBlockParam = media
      ? {
          type: "image",
          source: { type: "base64", media_type: media, data: toBase64(bytes) },
        }
      : {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: toBase64(bytes),
          },
        };

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 512,
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: "tool", name: "record_classification" },
      messages: [
        {
          role: "user",
          content: [
            attachment,
            {
              type: "text",
              text: [
                "This is a document uploaded to a hospital insurance claim.",
                `Filename: ${input.fileName}`,
                ...(input.ocrText
                  ? [
                      "",
                      "OCR text extracted from the page (may be imperfect on",
                      "handwriting — trust the image where they disagree):",
                      "---",
                      input.ocrText.slice(0, 6000),
                      "---",
                    ]
                  : []),
                "",
                "First: is this a hospital or insurance document at all? Files get",
                "dropped in here by mistake — a logo, a screenshot, a photo, a",
                "slide. Set is_claim_document false for those and return a null",
                "slot. Judge the page, not the filename: a file called",
                "estimate_sheet.png can be anything.",
                "",
                "If it is one, decide which of these checklist slots it belongs in:",
                ...input.candidateSlots.map((s) => `- ${s}`),
                "",
                "This list is what the claim is still missing, not a description of",
                "what you are holding. There is no requirement that one of them fit,",
                "and most documents fit none of them. Return null unless the",
                "document IS the thing the slot names — an ultrasound scan is not a",
                "photo ID proof, and a cost estimate is not a pre-authorisation",
                "form. Do not pick the closest one; a wrong suggestion costs the",
                "desk more time than no suggestion.",
                "",
                "Copy the slot text verbatim when one does fit. Many of these are",
                "handwritten scans; say so in your reason if the writing is unclear",
                "rather than guessing confidently.",
              ].join("\n"),
            },
          ],
        },
      ],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUse) {
      return {
        slot: null,
        confidence: 0,
        reason: "Couldn't read this document — please pick a slot.",
        classifiedBy: "claude",
      };
    }

    const result = toolUse.input as {
      slot: string | null;
      confidence: number;
      reason: string;
      is_claim_document: boolean;
    };

    // Nothing that isn't a claim document gets a slot, whatever else
    // came back. Asked only "which of these slots", a model answers
    // that question — a company logo was coming back as a
    // pre-authorisation form. The refusal has to be a field it fills in.
    if (result.is_claim_document === false) {
      return {
        slot: null,
        confidence: 0,
        reason: `Doesn't look like a claim document. ${result.reason}`.trim(),
        classifiedBy: "claude",
      };
    }

    // Trust nothing: the model can return a slot that isn't on this
    // claim's checklist, and filing against a slot that doesn't exist
    // would corrupt the gap view.
    const slot =
      result.slot && input.candidateSlots.includes(result.slot)
        ? result.slot
        : null;

    return {
      slot,
      confidence: slot ? Math.max(0, Math.min(1, result.confidence)) : 0,
      reason: slot
        ? result.reason
        : (result.reason ?? "No slot on this checklist matched."),
      classifiedBy: "claude",
    };
  }
}
