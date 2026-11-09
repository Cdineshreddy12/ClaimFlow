import type { ClaimStatus, SummarisationStatus } from "@claimflow/contracts";

export interface InboxQuery {
  id: string;
  claimId: string;
  /** "CLM-0042" — the uuid is never shown to a desk. */
  claimReference: string;
  tpaRawEmail: string | null;
  aiSummary: string | null;
  requestedItems: string[];
  /** 'claude' when generated, null when a desk exec typed it. */
  summarisedBy: string | null;
  /**
   * Whether the model was asked and what came back. Distinguishes a
   * summary that failed — which the panel offers to retry — from one
   * nobody ever ran.
   */
  summarisationStatus: SummarisationStatus;
  deadline: string | null;
  /** True when the deadline was calculated from a relative phrase, not read verbatim. */
  deadlineInferred: boolean;
  /**
   * When a human vouched for the deadline. Null means the summariser's
   * date is still unconfirmed — the countdown shows, dashed, with a
   * Confirm next to it (docs/adr/0005).
   */
  deadlineConfirmedAt: string | null;
  replySentAt: string | null;
  createdAt: string;
  claimPatientName: string;
  claimStatus: ClaimStatus;
  insurerName: string;
  procedureName: string;
}
