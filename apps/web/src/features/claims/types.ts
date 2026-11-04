import type { ClaimStatus } from "@claimflow/contracts";

export interface ChecklistSnapshotItem {
  documentType: string;
  required: boolean;
}

export interface Claim {
  id: string;
  patientName: string;
  insurerId: string;
  insurerName: string;
  procedureId: string;
  procedureName: string;
  status: ClaimStatus;
  assignedTo: string | null;
  checklistSnapshot: ChecklistSnapshotItem[];
  billedAmount: string | null;
  admittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimGaps {
  missing: string[];
  satisfied: string[];
}

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
