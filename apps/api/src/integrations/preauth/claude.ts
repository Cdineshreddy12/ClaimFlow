import Anthropic from "@anthropic-ai/sdk";
import {
  PREAUTH_FIELD_BY_KEY,
  parsePreauthValue,
  type PreauthExtraction,
  type PreauthFieldDef,
} from "@claimflow/contracts";
import type {
  ExtractionDocument,
  ExtractionInput,
  ExtractionOutcome,
  PreauthExtractor,
} from "./types.js";

/**
 * Reads a claim's confirmed documents and pulls out pre-auth form values.
 *
 * This is the retyping the brief is actually about: a desk executive
 * copying a diagnosis, an ICD code, an admission date and eight cost
 * lines out of a doctor's note and an estimate sheet, by hand, per
 * admission. Everything here is still a suggestion — nothing lands on
 * the form until a human confirms it (docs/adr/0005).
 *
 * Only *confirmed* documents are read. An unconfirmed upload hasn't been
 * vouched for as being what the classifier thinks it is, and reading a
 * pre-auth figure out of a misfiled page is exactly the error that ends
 * up on a form nobody re-checks.
 */

const MODEL = "claude-sonnet-5";

/** Per-document ceiling; the API rejects oversized inline attachments. */
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

/** Total across the request, so a claim with 15 scans doesn't build an unsendable message. */
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

const MAX_OCR_CHARS = 6000;

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/**
 * A scan too small to carry text.
 *
 * Placeholder and thumbnail files turn up in real document stores, and
 * the API rejects them outright — which, in a batched request, takes
 * every other document down with it. Catching them here keeps one
 * useless file from costing a desk the five good ones beside it.
 */
const MIN_IMAGE_PIXELS = 32;
const MIN_IMAGE_BYTES = 1024;

function isTooSmallToRead(bytes: Uint8Array): boolean {
  if (bytes.byteLength < MIN_IMAGE_BYTES) return true;

  // PNG carries its dimensions at a fixed offset, so this is exact
  // rather than a guess. Other formats fall back to the byte floor.
  const isPng =
    bytes.length > 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  if (!isPng) return false;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width < MIN_IMAGE_PIXELS || height < MIN_IMAGE_PIXELS;
}

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

function describeField(field: PreauthFieldDef): string {
  const parts = [`- ${field.key} (${field.type}): ${field.label}`];
  if (field.hint) parts.push(`    ${field.hint}`);
  if (field.options) {
    parts.push(`    one of: ${field.options.map((o) => o.value).join(", ")}`);
  }
  if (field.conditionalOn) {
    parts.push(
      `    only if ${field.conditionalOn.key} is ${field.conditionalOn.equals}`,
    );
  }
  return parts.join("\n");
}

function extractTool(documentIds: string[]): Anthropic.Tool {
  return {
    name: "record_preauth_fields",
    description:
      "Record the pre-authorisation form values found in these documents.",
    input_schema: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          description:
            "One entry per field you actually found. Omit fields that are not in the documents.",
          items: {
            type: "object",
            properties: {
              fieldKey: {
                type: "string",
                description: "One of the field keys given, copied verbatim.",
              },
              value: {
                type: "string",
                description:
                  "The value in the exact format named for that field's type. Dates YYYY-MM-DD, times HH:MM 24-hour, integers and currency as bare digits with no symbols, separators or words.",
              },
              confidence: {
                type: "number",
                description:
                  "0 to 1. Below 0.6 means a guess worth double-checking.",
              },
              sourceSnippet: {
                type: "string",
                description:
                  "The words from the document that carry this value, quoted. Shown to desk staff so they can check it without opening the file.",
              },
              sourceDocumentId: {
                type: ["string", "null"],
                description: `Which document it came from. One of: ${documentIds.join(", ")}`,
              },
            },
            required: [
              "fieldKey",
              "value",
              "confidence",
              "sourceSnippet",
              "sourceDocumentId",
            ],
          },
        },
      },
      required: ["fields"],
    },
  };
}

export class ClaudePreauthExtractor implements PreauthExtractor {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async extract(input: ExtractionInput): Promise<ExtractionOutcome> {
    const empty = { fields: [], documentsRead: 0 };
    if (input.fields.length === 0 || input.documents.length === 0) return empty;

    const content: Anthropic.ContentBlockParam[] = [];
    const included: ExtractionDocument[] = [];
    let totalBytes = 0;

    for (const doc of input.documents) {
      const media = imageMediaType(doc.contentType);
      const isPdf = doc.contentType === "application/pdf";
      if (!media && !isPdf) continue;

      const bytes = await doc.readBytes();
      if (bytes.byteLength > MAX_DOCUMENT_BYTES) continue;
      if (media && isTooSmallToRead(bytes)) continue;
      if (totalBytes + bytes.byteLength > MAX_TOTAL_BYTES) break;
      totalBytes += bytes.byteLength;

      const data = Buffer.from(bytes).toString("base64");
      // Label each attachment before it, so a snippet can be traced back
      // to a file rather than to "one of the documents".
      content.push({
        type: "text",
        text: `--- Document ${doc.id} · filed as "${doc.checklistSlot}" · ${doc.fileName}`,
      });
      content.push(
        media
          ? {
              type: "image",
              source: { type: "base64", media_type: media, data },
            }
          : {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data,
              },
            },
      );
      if (doc.ocrText) {
        content.push({
          type: "text",
          text: [
            "OCR text for the page above (imperfect on handwriting — trust",
            "the image where they disagree):",
            doc.ocrText.slice(0, MAX_OCR_CHARS),
          ].join("\n"),
        });
      }
      included.push(doc);
    }

    if (included.length === 0) return empty;

    content.push({
      type: "text",
      text: [
        `These are the confirmed documents on a cashless claim for ${input.patientName},`,
        `admitted for ${input.procedureName} at an Indian hospital.`,
        "",
        "Fill in what you can of the hospital's half of the IRDAI pre-authorisation",
        "form. These are the fields still blank:",
        "",
        ...input.fields.map(describeField),
        "",
        "Rules:",
        "- Only record a field if the documents actually say it. A blank field is",
        "  fine; a wrong one goes to a TPA on a form and gets the claim deducted.",
        "- Do not calculate, convert or total anything. If the sum total is not",
        "  written down, leave it out rather than adding the lines up.",
        "- Currency and integers must be bare digits: 185000, not 1,85,000 or",
        "  '1.85 lakh' or 'Rs. 185000'. If the document only gives a range or an",
        "  approximation, omit the field.",
        "- Quote the words the value came from in sourceSnippet. A desk executive",
        "  checks the snippet, not the file.",
        "- Much of this is handwritten. Where the writing is genuinely unclear,",
        "  lower the confidence and say so in the snippet rather than guessing.",
      ].join("\n"),
    });

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      tools: [extractTool(included.map((d) => d.id))],
      tool_choice: { type: "tool", name: "record_preauth_fields" },
      messages: [{ role: "user", content }],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUse) return { fields: [], documentsRead: included.length };

    const raw = (toolUse.input as { fields?: unknown }).fields;
    if (!Array.isArray(raw))
      return { fields: [], documentsRead: included.length };

    const requested = new Set(input.fields.map((f) => f.key));
    const documentIds = new Set(included.map((d) => d.id));
    const seen = new Set<string>();
    const results: PreauthExtraction[] = [];

    for (const item of raw) {
      const parsed = validate(item, requested, documentIds);
      if (!parsed) continue;
      // The model occasionally reports the same field twice from two
      // documents. First wins; a second opinion the desk can't see
      // between is not worth surfacing as a choice.
      if (seen.has(parsed.fieldKey)) continue;
      seen.add(parsed.fieldKey);
      results.push(parsed);
    }

    return { fields: results, documentsRead: included.length };
  }
}

/**
 * Trust nothing, same rule as the classifier. The model can name a field
 * that wasn't asked for, a document that wasn't sent, or write "approx
 * 1.8 lakh" into a currency field — each of those is dropped rather than
 * coerced, because a plausible wrong figure is the one that survives
 * review.
 */
function validate(
  item: unknown,
  requested: Set<string>,
  documentIds: Set<string>,
): PreauthExtraction | null {
  if (typeof item !== "object" || item === null) return null;
  const record = item as Record<string, unknown>;

  const fieldKey = record["fieldKey"];
  if (typeof fieldKey !== "string" || !requested.has(fieldKey)) return null;

  const field = PREAUTH_FIELD_BY_KEY[fieldKey];
  if (!field) return null;

  const rawValue = record["value"];
  if (typeof rawValue !== "string") return null;
  const value = parsePreauthValue(field, rawValue);
  if (value === null) return null;

  const rawConfidence = record["confidence"];
  const confidence =
    typeof rawConfidence === "number" && Number.isFinite(rawConfidence)
      ? Math.max(0, Math.min(1, rawConfidence))
      : 0.5;

  const rawSnippet = record["sourceSnippet"];
  const sourceSnippet =
    typeof rawSnippet === "string" && rawSnippet.trim()
      ? rawSnippet.trim().slice(0, 500)
      : "";

  const rawDocumentId = record["sourceDocumentId"];
  const sourceDocumentId =
    typeof rawDocumentId === "string" && documentIds.has(rawDocumentId)
      ? rawDocumentId
      : null;

  return { fieldKey, value, confidence, sourceSnippet, sourceDocumentId };
}
