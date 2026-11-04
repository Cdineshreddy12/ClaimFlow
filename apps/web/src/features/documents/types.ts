export interface ClaimDocument {
  id: string;
  claimId: string;
  fileUrl: string;
  aiClassifiedType: string | null;
  checklistSlot: string | null;
  confidence: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
}
