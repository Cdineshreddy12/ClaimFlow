import type { DocumentClassification } from "@claimflow/contracts";

export interface ClassificationInput {
  fileName: string;
  contentType: string;
  /** Lazy: the heuristic classifier never needs the bytes, so don't pay S3 for them unless a provider asks. */
  readBytes: () => Promise<Uint8Array>;
  /** The claim's frozen checklist snapshot — the only slots worth suggesting. */
  candidateSlots: string[];
}

export interface DocumentClassifier {
  classify(input: ClassificationInput): Promise<DocumentClassification>;
}
