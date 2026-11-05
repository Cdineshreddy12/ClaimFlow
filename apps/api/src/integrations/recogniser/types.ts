/**
 * Working out which claim a loose document belongs to.
 *
 * The classifier answers "which slot on this claim" and has a claim
 * handed to it. This answers the question before that one — a scan
 * arrives with no claim at all, and the patient's name, UHID or claim
 * reference on the page is the only thing that connects it to anything.
 *
 * Kept apart from the classifier rather than folded into it because the
 * two fail differently and a desk needs to see which one was unsure. A
 * document matched to the wrong patient is a different and much worse
 * error than one filed in the wrong slot of the right claim.
 */

/** One claim the document might belong to, as the model sees it. */
export interface ClaimCandidate {
  id: string;
  /** "CLM-0001" — what a human would read off the page. */
  reference: string;
  patientName: string;
  procedureName: string;
  insurerName: string;
  status: string;
}

export interface RecognitionInput {
  fileName: string;
  contentType: string;
  readBytes: () => Promise<Uint8Array>;
  /** Textract's reading, when the file was one it could read. */
  ocrText?: string | undefined;
  candidates: ClaimCandidate[];
}

export interface Recognition {
  /** Null when nothing on the page identifies a claim on the list. */
  claimId: string | null;
  confidence: number;
  /**
   * What on the page identified the patient — a name, a UHID, a claim
   * reference. Shown to the desk before they approve, because "the
   * patient name matches" and "it says CLM-0001 on it" are very
   * different levels of proof and only a human can tell which one the
   * situation needs.
   */
  reason: string;
  /** What kind of document it appears to be, in the model's own words. */
  documentKind: string | null;
}

export interface ClaimRecogniser {
  recognise(input: RecognitionInput): Promise<Recognition>;
}
