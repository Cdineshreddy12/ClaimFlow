import { z } from "zod";
import type { Role } from "../auth/roles.js";

/**
 * Claim lifecycle, matching the hospital's own vocabulary (pre-auth, query,
 * approved, final bill, settled) rather than a generic ticketing model.
 * Enhancement (requesting a higher sanctioned amount mid-treatment) is a
 * distinct workflow from a document query — different data, different SLA
 * clock — and must never collapse into QUERY_RAISED.
 *
 * See docs/adr/0004-claim-state-machine.md for the full rationale.
 */
export const ClaimStatus = z.enum([
  "DRAFT",
  "PRE_AUTH_SENT",
  "QUERY_RAISED",
  "ENHANCEMENT_REQUESTED",
  "APPROVED",
  "FINAL_BILL_SUBMITTED",
  "SETTLED",
  "REJECTED",
]);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

interface Transition {
  to: ClaimStatus[];
  /** Roles allowed to perform this transition; omit to allow any authenticated role. */
  roles?: Role[];
}

/**
 * Declarative transition table — deliberately not a state-machine library.
 * At this scale a plain, auditable map is easier for a reviewer to verify
 * than a library's DSL, and it's the single source of truth both the API
 * (authorization) and the UI (which actions to render) read from.
 */
export const CLAIM_TRANSITIONS: Record<ClaimStatus, Transition> = {
  DRAFT: { to: ["PRE_AUTH_SENT"] },
  PRE_AUTH_SENT: {
    to: ["QUERY_RAISED", "ENHANCEMENT_REQUESTED", "APPROVED", "REJECTED"],
  },
  QUERY_RAISED: { to: ["PRE_AUTH_SENT"] },
  ENHANCEMENT_REQUESTED: { to: ["PRE_AUTH_SENT", "APPROVED", "REJECTED"] },
  APPROVED: { to: ["FINAL_BILL_SUBMITTED"] },
  FINAL_BILL_SUBMITTED: { to: ["SETTLED"], roles: ["desk_head"] },
  SETTLED: { to: [] },
  REJECTED: { to: [] },
};

export function canTransition(
  from: ClaimStatus,
  to: ClaimStatus,
  role: Role,
): boolean {
  const transition = CLAIM_TRANSITIONS[from];
  if (!transition.to.includes(to)) return false;
  if (transition.roles && !transition.roles.includes(role)) return false;
  return true;
}
