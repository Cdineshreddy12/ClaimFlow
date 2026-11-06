import type { ClassifierKind } from "@claimflow/contracts";

export interface ClaimDocument {
  id: string;
  claimId: string;
  fileUrl: string;
  /** Suggested slot. A suggestion only — checklistSlot is where it actually sits. */
  aiClassifiedType: string | null;
  checklistSlot: string | null;
  confidence: string | null;
  classifiedBy: ClassifierKind | null;
  classificationReason: string | null;
  /** When it was last read. Null means nothing ever has been. */
  classifiedAt?: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
}
