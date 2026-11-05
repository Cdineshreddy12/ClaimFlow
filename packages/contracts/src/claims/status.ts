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

/**
 * A claim's status as someone would say it out loud.
 *
 * Distinct from the web app's `STATUS_LABEL`, which is deliberately
 * clipped to fit a table chip ("Final bill", "Query"). These read as
 * part of a sentence, because they end up in one — the assistant was
 * quoting `FINAL_BILL_SUBMITTED` at desk staff, which is the database
 * talking rather than a colleague.
 */
export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  DRAFT: "draft",
  PRE_AUTH_SENT: "pre-auth sent",
  QUERY_RAISED: "query raised",
  ENHANCEMENT_REQUESTED: "enhancement requested",
  APPROVED: "approved",
  FINAL_BILL_SUBMITTED: "final bill submitted",
  SETTLED: "settled",
  REJECTED: "rejected",
};

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

/**
 * A claim nothing more can happen to — derived from the transition
 * table rather than listed again, so a status that gains an outgoing
 * move stops being terminal automatically.
 *
 * Three places had their own copy of `["SETTLED", "REJECTED"]` before
 * this existed: the dashboard's open-claim count, the checklist's
 * active-claim guard, and the claims list. They are the same fact.
 */
export const TERMINAL_STATUSES: ClaimStatus[] = ClaimStatus.options.filter(
  (status) => CLAIM_TRANSITIONS[status].to.length === 0,
);

export function isTerminal(status: ClaimStatus): boolean {
  return CLAIM_TRANSITIONS[status].to.length === 0;
}

/**
 * The claims a desk has to do something about today. Distinct from
 * "open": a pre-auth that's been sent is open but waiting on the
 * insurer, whereas a query or an enhancement is waiting on the desk.
 */
export const NEEDS_ATTENTION_STATUSES: ClaimStatus[] = [
  "QUERY_RAISED",
  "ENHANCEMENT_REQUESTED",
];

export function needsAttention(status: ClaimStatus): boolean {
  return NEEDS_ATTENTION_STATUSES.includes(status);
}
