import type { ClaimStatus } from "@claimflow/contracts";

/**
 * How a decision reads in the turnaround table.
 *
 * The claim-status labels name a *state* ("Pre-auth sent"); this table
 * is about the *decision* the insurer owed from that state, which is a
 * different sentence.
 */
export const CLAIM_STATUS_LABELS: Partial<Record<ClaimStatus, string>> = {
  PRE_AUTH_SENT: "Cashless decision",
  FINAL_BILL_SUBMITTED: "Discharge authorisation",
  ENHANCEMENT_REQUESTED: "Enhancement decision",
};
