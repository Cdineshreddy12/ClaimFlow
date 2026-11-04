import type { DocumentClassification } from "@claimflow/contracts";

export interface ClassificationInput {
  fileName: string;
  contentType: string;
  /** Lazy: the heuristic classifier never needs the bytes, so don't pay S3 for them unless a provider asks. */
  readBytes: () => Promise<Uint8Array>;
  /** The claim's frozen checklist snapshot — the only slots worth suggesting. */
  candidateSlots: string[];
  /**
   * Text pulled out by OCR, when it ran. Supplements the image rather
   * than replacing it: Textract is better at getting characters out of
   * messy handwriting, the model is better at working out what the
   * document is. Giving both beats either alone.
   */
  ocrText?: string | undefined;
}

export interface DocumentClassifier {
  classify(input: ClassificationInput): Promise<DocumentClassification>;
}
