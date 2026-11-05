import Anthropic from "@anthropic-ai/sdk";
import type {
  ClaimRecogniser,
  Recognition,
  RecognitionInput,
} from "./types.js";

/**
 * Reads a loose document and says which open claim it belongs to.
 *
 * Still a suggestion, and a louder one than most: this is the only
 * place in the product where being wrong puts a patient's paperwork on
 * another patient's claim. So it is told to abstain by default, its
 * reason has to quote what it actually matched on, and nothing files
 * anything until a human approves it (docs/adr/0005).
 */

const MODEL = "claude-sonnet-5";

/** The API rejects oversized inline attachments; skip rather than fail the upload. */
const MAX_INLINE_BYTES = 4 * 1024 * 1024;

const MAX_OCR_CHARS = 6000;

/**
 * How many open claims get offered at once.
 *
 * A single hospital's desk rarely has more than this in flight, and a
 * list long enough to blur is worse than a short one that misses: a
 * miss returns null and asks the desk, which is a recoverable outcome.
 */
const MAX_CANDIDATES = 60;

const RECOGNISE_TOOL: Anthropic.Tool = {
  name: "record_recognition",
  description:
    "Record which open claim this document belongs to, or that none of them does.",
  input_schema: {
    type: "object",
    properties: {
      claim_reference: {
        type: ["string", "null"],
        description:
          "The reference of exactly one claim from the list, copied verbatim (e.g. CLM-0001). Null if the document doesn't clearly belong to any of them.",
      },
      confidence: {
        type: "number",
        description:
          "0 to 1. Use below 0.6 when you are matching on a common name alone with nothing else to corroborate it.",
      },
      reason: {
        type: "string",
        description:
          "Quote what on the page identified it — the patient name, UHID, claim reference or policy number as it actually appears. One sentence. This is shown to desk staff before they approve the filing.",
      },
      document_kind: {
        type: ["string", "null"],
        description:
          "What this document is, in a few words (e.g. 'ultrasound report', 'discharge summary', 'pharmacy receipt'). Null if unreadable.",
      },
    },
    required: ["claim_reference", "confidence", "reason", "document_kind"],
  },
};

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

function unreadable(reason: string): Recognition {
  return { claimId: null, confidence: 0, reason, documentKind: null };
}

export class ClaudeRecogniser implements ClaimRecogniser {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async recognise(input: RecognitionInput): Promise<Recognition> {
    if (input.candidates.length === 0) {
      return unreadable("There are no open claims to match this against.");
    }

    const bytes = await input.readBytes();
    if (bytes.byteLength > MAX_INLINE_BYTES) {
      return unreadable(
        "File is too large to read automatically — please pick the claim.",
      );
    }

    const media = imageMediaType(input.contentType);
    const isPdf = input.contentType === "application/pdf";
    if (!media && !isPdf) {
      return unreadable(
        `Can't read ${input.contentType} automatically — please pick the claim.`,
      );
    }

    const attachment: Anthropic.ContentBlockParam = media
      ? {
          type: "image",
          source: {
            type: "base64",
            media_type: media,
            data: Buffer.from(bytes).toString("base64"),
          },
        }
      : {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: Buffer.from(bytes).toString("base64"),
          },
        };

    const candidates = input.candidates.slice(0, MAX_CANDIDATES);

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 512,
      tools: [RECOGNISE_TOOL],
      tool_choice: { type: "tool", name: "record_recognition" },
      messages: [
        {
          role: "user",
          content: [
            attachment,
            {
              type: "text",
              text: [
                "A hospital insurance desk has been handed this document with no",
                "claim attached to it. Work out which of their open claims it",
                "belongs to.",
                `Filename: ${input.fileName}`,
                ...(input.ocrText
                  ? [
                      "",
                      "OCR text from the page (imperfect on handwriting — trust the",
                      "image where they disagree):",
                      "---",
                      input.ocrText.slice(0, MAX_OCR_CHARS),
                      "---",
                    ]
                  : []),
                "",
                "Open claims:",
                ...candidates.map(
                  (c) =>
                    `- ${c.reference} — ${c.patientName}, ${c.procedureName}, ${c.insurerName} (${c.status})`,
                ),
                "",
                "Match on what the page actually says: the patient's name, a UHID,",
                "a claim reference, a policy number, or a procedure that only one",
                "of these claims could be about.",
                "",
                "Return null rather than guessing. Filing a document onto the wrong",
                "patient's claim is the worst thing that can happen here — much",
                "worse than asking the desk which claim it is. A shared surname, or",
                "a document that could belong to two of these claims equally, is a",
                "null, not a coin toss.",
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
      return unreadable("Couldn't read this document — please pick the claim.");
    }

    const result = toolUse.input as {
      claim_reference: string | null;
      confidence: number;
      reason: string;
      document_kind: string | null;
    };

    // Resolve the reference against the list we actually offered. The
    // model can return a reference that doesn't exist, and a made-up
    // claim id would be filed against nothing or — worse — against
    // whatever happened to collide.
    const matched = result.claim_reference
      ? candidates.find((c) => c.reference === result.claim_reference)
      : undefined;

    return {
      claimId: matched?.id ?? null,
      confidence: matched ? Math.max(0, Math.min(1, result.confidence)) : 0,
      reason: matched
        ? result.reason
        : (result.reason ?? "No open claim on the list matched this document."),
      documentKind: result.document_kind ?? null,
    };
  }
}
