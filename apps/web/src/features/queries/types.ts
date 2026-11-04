import type { ClaimStatus } from "@claimflow/contracts";

export interface InboxQuery {
  id: string;
  claimId: string;
  tpaRawEmail: string | null;
  aiSummary: string | null;
  requestedItems: string[];
  deadline: string | null;
  replySentAt: string | null;
  createdAt: string;
  claimPatientName: string;
  claimStatus: ClaimStatus;
  insurerName: string;
  procedureName: string;
}
