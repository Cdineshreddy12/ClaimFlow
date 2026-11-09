import { z } from "zod";
import type { Role } from "../auth/roles.js";

/**
 * Claim lifecycle, matching the hospital's own vocabulary (pre-auth, query,
 * approved, final bill, settled) rather than a generic ticketing model.
 * Enhancement (requesting a higher sanctioned amount mid-treatment) is a
 * distinct workflow from a document query — different data, different SLA
 * clock — and must never collapse into QUERY_RAISED.
 *
 * `DISCHARGE_AUTHORISED` is there for the same reason. The final bill
 * goes to the insurer and two different things come back: permission to
 * discharge the patient, which IRDAI gives them three hours for, and the
 * money, which takes weeks and no regulation times. With only
 * `SETTLED` after `FINAL_BILL_SUBMITTED`, turnaround measured the gap to
 * payment against the three-hour window and reported every insurer as
 * 100% past target — a patient waiting on a bed and an invoice waiting
 * on a bank transfer counted as the same delay.
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
  "DISCHARGE_AUTHORISED",
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
  DISCHARGE_AUTHORISED: "discharge authorised",
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
  /*
    An approved claim can still need more money, and usually that is
    exactly when it does: the sanction is agreed on admission and the
    overrun is discovered mid-stay, when the patient deteriorates. The
    table used to allow only the final bill from here, so the
    enhancement flow wrote its own status change straight to the
    repository and skipped this table altogether — the one structure
    that is supposed to guarantee a claim cannot move illegally.

    Permitting it here is what makes that bypass unnecessary. Before
    approval there is nothing to enhance; you revise the pre-auth.
  */
  APPROVED: { to: ["ENHANCEMENT_REQUESTED", "FINAL_BILL_SUBMITTED"] },
  /*
    Settling is the one irreversible money transition, so it is held
    back from a desk executive. It listed only `desk_head`, which
    locked out `org_admin` as well — the role that is strictly more
    privileged everywhere else in the product (insurers, rules,
    branding, reports, receivables are all
    requireRole("org_admin", "desk_head")).

    A hospital whose only admin is an org_admin could not settle a
    claim at all, which is the last step of every claim that goes
    right.
  */
  /*
    Recording that the insurer authorised discharge is not a money
    move — the patient can leave, nothing has been paid — so any desk
    user may do it. It is also the step a desk is most likely to be
    recording with a patient standing at the counter, which is a poor
    moment to discover you lack the role.
  */
  FINAL_BILL_SUBMITTED: { to: ["DISCHARGE_AUTHORISED"] },
  DISCHARGE_AUTHORISED: {
    to: ["SETTLED"],
    roles: ["org_admin", "desk_head"],
  },
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
