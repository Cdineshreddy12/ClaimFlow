import type { PreauthExtraction, PreauthFieldDef } from "@claimflow/contracts";

export interface ExtractionDocument {
  id: string;
  fileName: string;
  contentType: string;
  /** The checklist slot a human filed it under — context the model uses to weight what it reads. */
  checklistSlot: string;
  readBytes: () => Promise<Uint8Array>;
  /**
   * Textract output, when the file was an image it could read. Same
   * reasoning as the classifier: handwriting is where character
   * extraction beats a vision model, and pre-auth values come off
   * handwritten doctors' notes more than anything else.
   */
  ocrText?: string | undefined;
}

export interface ExtractionInput {
  /** The fields worth asking for — the catalogue minus what a human has already confirmed. */
  fields: PreauthFieldDef[];
  documents: ExtractionDocument[];
  /** Context that helps disambiguate: "the gall bladder removal on Meera Joshi". */
  patientName: string;
  procedureName: string;
}

export interface ExtractionOutcome {
  /**
   * Only what was actually found. An extractor that invents a value to
   * fill a slot costs the desk more than an empty field, so returning
   * fewer results than fields asked for is the normal case.
   */
  fields: PreauthExtraction[];
  /**
   * How many documents were genuinely read — not how many were offered.
   * Unreadable file types and degenerate images get skipped, and
   * reporting the offered count would tell a desk their notes were read
   * when they weren't.
   */
  documentsRead: number;
}

export interface PreauthExtractor {
  extract(input: ExtractionInput): Promise<ExtractionOutcome>;
}
