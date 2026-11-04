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
    },
    required: ["slot", "confidence", "reason"],
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
                "Decide which of these checklist slots it belongs in:",
                ...input.candidateSlots.map((s) => `- ${s}`),
                "",
                "Copy the slot text verbatim if one fits. If none fits, return null —",
                "a wrong suggestion costs the desk more time than no suggestion.",
                "Many of these are handwritten scans; say so in your reason if the",
                "writing is unclear rather than guessing confidently.",
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
    };

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
