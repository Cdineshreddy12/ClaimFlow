import type { ClaimStatus } from "@claimflow/contracts";

export interface InboxQuery {
  id: string;
  claimId: string;
  tpaRawEmail: string | null;
  aiSummary: string | null;
  requestedItems: string[];
  /** 'claude' when generated, null when a desk exec typed it. */
  summarisedBy: string | null;
  deadline: string | null;
  /** True when the deadline was calculated from a relative phrase, not read verbatim. */
  deadlineInferred: boolean;
  replySentAt: string | null;
  createdAt: string;
  claimPatientName: string;
  claimStatus: ClaimStatus;
  insurerName: string;
  procedureName: string;
}
