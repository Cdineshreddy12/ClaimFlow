import type { EnhancementStatus, ClaimStatus } from "@claimflow/contracts";

export interface ChecklistSnapshotItem {
  /** Set when a desk added this slot to this one claim after it was opened. */
  addedAt?: string;
  /** True for a requirement restored from the rules — not removable. */
  fromRules?: boolean;
  addedBy?: string | null;
  documentType: string;
  required: boolean;
}

export interface Claim {
  id: string;
  /** "CLM-0042" — what the desk quotes to a TPA. The uuid is never shown. */
  reference: string;
  patientName: string;
  insurerId: string;
  insurerName: string;
  procedureId: string;
  procedureName: string;
  status: ClaimStatus;
  assignedTo: string | null;
  checklistSnapshot: ChecklistSnapshotItem[];
  billedAmount: string | null;
  /** Government scheme claims only — the code picked, and what it pays. */
  packageCode?: string | null;
  packageRate?: string | null;
  /** What the insurer authorised, enhancements included — docs/adr/0012. */
  sanctionedAmount: string | null;
  /** What actually arrived, and the day it did. Not inferred from the above. */
  settledAmount: string | null;
  settledOn: string | null;
  admittedAt: string | null;
  /** Deadline on the claim's current status, from its latest status event. */
  slaDeadline: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Enhancement {
  id: string;
  claimId: string;
  requestedAmount: string;
  reason: string;
  status: EnhancementStatus;
  approvedAmount: string | null;
  slaDeadline: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface ClaimGaps {
  missing: string[];
  satisfied: string[];
}

/**
 * Clipped to fit a table chip. For a status inside a sentence use
 * CLAIM_STATUS_LABEL from @claimflow/contracts — "Final bill" is a
 * column header, "final bill submitted" is English.
 */
export const STATUS_LABEL: Record<ClaimStatus, string> = {
  DRAFT: "Draft",
  PRE_AUTH_SENT: "Pre-auth sent",
  QUERY_RAISED: "Query",
  ENHANCEMENT_REQUESTED: "Enhancement",
  APPROVED: "Approved",
  FINAL_BILL_SUBMITTED: "Final bill",
  SETTLED: "Settled",
  REJECTED: "Rejected",
};

export const STATUS_CHIP_VARIANT: Record<
  ClaimStatus,
  "approved" | "pending" | "critical" | "neutral"
> = {
  DRAFT: "neutral",
  PRE_AUTH_SENT: "neutral",
  QUERY_RAISED: "critical",
  ENHANCEMENT_REQUESTED: "pending",
  APPROVED: "approved",
  FINAL_BILL_SUBMITTED: "approved",
  SETTLED: "approved",
  REJECTED: "critical",
};
