import type { PreauthExtractorKind } from "@claimflow/contracts";

/**
 * One stored pre-auth field. The catalogue — labels, types, grouping —
 * lives in @claimflow/contracts and is rendered from there; this is only
 * what the server knows that the catalogue can't say.
 */
export interface PreauthFieldRow {
  id: string;
  claimId: string;
  fieldKey: string;
  /** What a human stands behind. Null means still unanswered. */
  value: string | null;
  /** The suggestion. Never shown as the answer — adr 0005. */
  aiValue: string | null;
  confidence: string | null;
  sourceSnippet: string | null;
  sourceDocumentId: string | null;
  extractedBy: PreauthExtractorKind | null;
  extractedAt: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export interface PreauthFieldsResponse {
  fields: PreauthFieldRow[];
  /**
   * False when no model is configured. The button says so rather than
   * running and reporting it found nothing, which reads as broken.
   */
  extractionAvailable: boolean;
}

export interface ExtractionResult {
  extracted: number;
  documentsRead: number;
  fieldsRemaining: number;
  extractionAvailable: boolean;
}
