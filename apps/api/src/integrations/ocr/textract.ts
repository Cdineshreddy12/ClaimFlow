import {
  DetectDocumentTextCommand,
  TextractClient,
} from "@aws-sdk/client-textract";

/**
 * Synchronous OCR for a single page image.
 *
 * Deliberately only `DetectDocumentText`: raw text, no forms or tables.
 * The async API would additionally need Textract granted its own read
 * access into the documents bucket; passing bytes inline keeps that
 * grant unnecessary. See infra/iam/README.md.
 */

/** Textract's hard limit for a synchronous inline call. */
const MAX_SYNC_BYTES = 5 * 1024 * 1024;

export interface OcrResult {
  text: string;
  /** Mean Textract confidence across lines, 0..1. Low means messy handwriting. */
  confidence: number;
  lineCount: number;
}

let client: TextractClient | undefined;

function getClient(): TextractClient {
  if (!client) {
    const region = process.env.AWS_TEXTRACT_REGION ?? process.env.AWS_REGION;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    if (!region || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "AWS_TEXTRACT_REGION/AWS_REGION and AWS credentials are required for OCR — see .env.example",
      );
    }
    client = new TextractClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return client;
}

/** Textract reads images; a PDF would need the async API and the extra S3 grant. */
export function canOcr(contentType: string): boolean {
  return ["image/jpeg", "image/jpg", "image/png", "image/tiff"].includes(
    contentType,
  );
}

export async function detectText(bytes: Uint8Array): Promise<OcrResult | null> {
  if (bytes.byteLength > MAX_SYNC_BYTES) return null;

  const response = await getClient().send(
    new DetectDocumentTextCommand({ Document: { Bytes: bytes } }),
  );

  const lines = (response.Blocks ?? []).filter((b) => b.BlockType === "LINE");
  if (lines.length === 0) return null;

  const text = lines.map((l) => l.Text ?? "").join("\n");
  const confidence =
    lines.reduce((sum, l) => sum + (l.Confidence ?? 0), 0) / lines.length / 100;

  return { text, confidence, lineCount: lines.length };
}
