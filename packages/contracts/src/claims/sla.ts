import type { ClaimStatus } from "./status.js";

/**
 * The clocks a cashless desk is actually judged by.
 *
 * `claim_status_events.sla_deadline` has existed since the schema was
 * written, with a comment saying it "backs the IRDAI/TPA SLA
 * countdowns". Nothing ever computed it and nothing ever read it — the
 * column was filled only if a caller passed a value, which meant the
 * deadline was whatever the browser said it was. docs/adr/0004 is
 * explicit that this must never be computed from the frontend clock, so
 * the windows live here and the server stamps them.
 *
 * `owedBy` is the half that makes the dashboard honest. A claim waiting
 * on an insurer and a claim waiting on the desk are both "open", and
 * only one of them is anybody here's fault.
 */

export type SlaOwner = "insurer" | "desk";

export interface SlaWindow {
  hours: number;
  owedBy: SlaOwner;
  /** Where the number comes from, shown in the UI so nobody has to trust it blind. */
  basis: string;
}

/**
 * IRDAI's 2024 health insurance master circular puts a one-hour limit on
 * deciding a cashless request and three hours on authorising discharge.
 * Those are obligations on the insurer, which is why both sit with
 * `owedBy: "insurer"` — the desk's own clocks are the query replies,
 * and those come from the TPA's email rather than a regulation.
 */
export const SLA_WINDOWS: Partial<Record<ClaimStatus, SlaWindow>> = {
  PRE_AUTH_SENT: {
    hours: 1,
    owedBy: "insurer",
    basis: "IRDAI: cashless decision within 1 hour of request",
  },
  FINAL_BILL_SUBMITTED: {
    hours: 3,
    owedBy: "insurer",
    basis: "IRDAI: discharge authorisation within 3 hours",
  },
  /**
   * No regulation names a window for an enhancement. It is the same
   * class of request as a pre-auth — an authorisation decision while a
   * patient is admitted — so it inherits the same hour, and the basis
   * string says plainly that this is our inference and not a mandate.
   */
  ENHANCEMENT_REQUESTED: {
    hours: 1,
    owedBy: "insurer",
    basis: "Treated as a cashless decision (no IRDAI window for enhancements)",
  },
};

export function slaWindowFor(status: ClaimStatus): SlaWindow | null {
  return SLA_WINDOWS[status] ?? null;
}

/**
 * Who is sitting on a claim in each state.
 *
 * Deliberately separate from `SLA_WINDOWS`. A window is a *deadline*
 * and only three statuses carry one, all of them the insurer's. This
 * says who holds the ball, which every open status answers — and the
 * brief asks for it directly: IRDAI gives insurers an hour, "so the
 * hospital's own delays must be timed".
 *
 * Without this, turnaround reporting could only ever describe the other
 * side of the table. A desk that takes six hours to send a pre-auth has
 * spent six hours of a patient's admission, and no amount of insurer
 * statistics will show it.
 *
 * `SETTLED` and `REJECTED` are absent on purpose: they are terminal, so
 * nobody is holding anything and there is no duration left to measure.
 */
export const STATUS_HELD_BY: Partial<Record<ClaimStatus, SlaOwner>> = {
  // Admitted, and not yet asked for. The clearest hospital-side delay
  // in the product, and the one nothing measured.
  DRAFT: "desk",
  PRE_AUTH_SENT: "insurer",
  // The TPA has asked something; replying is ours. The reply deadline
  // itself still comes from the TPA's own email, never from here.
  QUERY_RAISED: "desk",
  ENHANCEMENT_REQUESTED: "insurer",
  // Authorised, waiting on us to bill it.
  APPROVED: "desk",
  FINAL_BILL_SUBMITTED: "insurer",
};

export function heldBy(status: ClaimStatus): SlaOwner | null {
  return STATUS_HELD_BY[status] ?? null;
}

/** The statuses one side is accountable for, for grouping a report. */
export function statusesHeldBy(owner: SlaOwner): ClaimStatus[] {
  return (Object.keys(STATUS_HELD_BY) as ClaimStatus[]).filter(
    (status) => STATUS_HELD_BY[status] === owner,
  );
}

/**
 * What the desk is doing while it holds a claim, phrased as the work
 * rather than the state. "Draft" is a database value; "Admitted →
 * pre-auth sent" is the gap a desk head can actually shorten.
 */
export const DESK_HOLD_LABEL: Partial<Record<ClaimStatus, string>> = {
  DRAFT: "Opened → pre-auth sent",
  QUERY_RAISED: "Query received → replied",
  APPROVED: "Approved → final bill sent",
};

/**
 * The deadline for entering a status, or null for the statuses that
 * don't carry one.
 *
 * `QUERY_RAISED` deliberately returns null: the reply window is
 * whatever the TPA's email said, which the query itself already stores
 * (and flags as calculated when it was inferred from "within 48
 * hours"). Inventing a second, regulatory-looking deadline here would
 * put two different numbers in front of the desk for the same promise.
 */
export function slaDeadlineFor(status: ClaimStatus, from: Date): Date | null {
  const window = slaWindowFor(status);
  if (!window) return null;
  return new Date(from.getTime() + window.hours * 3_600_000);
}

export type SlaState = "none" | "ok" | "due_soon" | "breached" | "met";

/** Inside this much of the deadline, the countdown is worth looking at. */
export const SLA_DUE_SOON_RATIO = 0.25;

/**
 * Where a clock stands.
 *
 * `met` exists so a claim that was answered in time stops showing a
 * countdown at all: once the insurer has responded the deadline is
 * history, and a breach stamped on a claim that was actually answered
 * late-but-answered is a different fact from one still running.
 */
export function slaState(input: {
  deadline: Date | string | null | undefined;
  /** When the status this deadline belonged to was superseded, if it has been. */
  resolvedAt?: Date | string | null | undefined;
  now: Date | number;
  window?: SlaWindow | null;
}): { state: SlaState; remainingMs: number | null } {
  if (!input.deadline) return { state: "none", remainingMs: null };

  const deadline = new Date(input.deadline).getTime();
  if (Number.isNaN(deadline)) return { state: "none", remainingMs: null };

  if (input.resolvedAt) {
    const resolved = new Date(input.resolvedAt).getTime();
    return {
      state: resolved <= deadline ? "met" : "breached",
      remainingMs: deadline - resolved,
    };
  }

  const now = typeof input.now === "number" ? input.now : input.now.getTime();
  const remainingMs = deadline - now;
  if (remainingMs <= 0) return { state: "breached", remainingMs };

  const windowMs = (input.window?.hours ?? 1) * 3_600_000;
  if (remainingMs <= windowMs * SLA_DUE_SOON_RATIO) {
    return { state: "due_soon", remainingMs };
  }
  return { state: "ok", remainingMs };
}
