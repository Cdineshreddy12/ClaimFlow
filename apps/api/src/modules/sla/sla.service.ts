import {
  DESK_HOLD_LABEL,
  slaState,
  slaWindowFor,
  type ClaimStatus,
  type Role,
  type SlaOwner,
  type SlaState,
} from "@claimflow/contracts";
import * as repo from "./sla.repository.js";

interface AuthContext {
  userId: string;
  role: Role;
}

export interface SlaWatchItem {
  claimId: string;
  reference: string;
  patientName: string;
  insurerName: string;
  status: ClaimStatus;
  enteredAt: Date;
  slaDeadline: Date | null;
  state: SlaState;
  remainingMs: number | null;
  owedBy: SlaOwner | null;
  basis: string | null;
}

export interface SlaWatch {
  /** Claims on a clock, worst first. */
  items: SlaWatchItem[];
  breached: number;
  dueSoon: number;
  /**
   * Of the breaches, how many are the insurer's to answer. Split out
   * because the desk is held to account for the whole number and only
   * owns part of it.
   */
  breachedOnInsurer: number;
}

/**
 * Which claims are against the clock right now.
 *
 * The state is computed here rather than stored: a deadline is a fact
 * and a breach is a comparison against the current time, and persisting
 * the comparison would mean a "breached" flag that was true when it was
 * written and wrong a minute later. Same reasoning as the checklist gap
 * view in docs/adr/0001.
 */
export async function getSlaWatch(
  auth: AuthContext,
  now = new Date(),
): Promise<SlaWatch> {
  const rows = await repo.listOpenClaimClocks();

  const items = rows
    .map((row) => {
      const window = slaWindowFor(row.status);
      const { state, remainingMs } = slaState({
        deadline: row.slaDeadline,
        now,
        window,
      });
      return {
        ...row,
        state,
        remainingMs,
        owedBy: window?.owedBy ?? null,
        basis: window?.basis ?? null,
      };
    })
    // Claims with no clock at all (a draft, an approved claim waiting on
    // the hospital) are not on this list. They're not late; they're not
    // waiting on anybody.
    .filter((item) => item.state !== "none")
    // Worst first: the most overdue at the top, then the nearest due.
    .sort((a, b) => (a.remainingMs ?? 0) - (b.remainingMs ?? 0));

  return {
    items,
    breached: items.filter((i) => i.state === "breached").length,
    dueSoon: items.filter((i) => i.state === "due_soon").length,
    breachedOnInsurer: items.filter(
      (i) => i.state === "breached" && i.owedBy === "insurer",
    ).length,
  };
}

export interface TurnaroundReport {
  since: Date;
  rows: (repo.TurnaroundRow & {
    /** The window this is measured against, when there is one. */
    targetHours: number | null;
    /** Breaches as a share of decisions, 0–1. */
    breachRate: number;
  })[];
  /**
   * The same question asked about us.
   *
   * IRDAI gives insurers an hour, so the hospital's own lag is the part
   * it can actually do something about — and every number above this
   * line is about somebody else's performance.
   */
  desk: (repo.DeskTurnaroundRow & { label: string })[];
}

/**
 * What each insurer actually does, against what it is supposed to do.
 *
 * This is the report a hospital takes into its next negotiation: the
 * desk's own timestamps, per insurer, next to the regulatory window.
 * Nothing else in the product gives the hospital a number to push back
 * with — see docs/adr/0014.
 *
 * `until` is open-ended unless given, same as `deductions.summarise` —
 * the Turnaround page wants "last 30 days to now", the period report
 * (docs/adr/0018) wants one closed month.
 */
export async function getTurnaroundReport(
  auth: AuthContext,
  since: Date,
  until?: Date,
): Promise<TurnaroundReport> {
  const [rows, desk] = await Promise.all([
    repo.insurerTurnaround(since, until),
    repo.deskTurnaround(since, until),
  ]);

  return {
    since,
    desk: desk.map((row) => ({
      ...row,
      // Phrased as the work, not the state: "Draft" is a database
      // value, "Opened → pre-auth sent" is a gap a desk head can
      // actually shorten.
      label: DESK_HOLD_LABEL[row.fromStatus] ?? row.fromStatus,
    })),
    rows: rows.map((row) => ({
      ...row,
      targetHours: slaWindowFor(row.fromStatus)?.hours ?? null,
      breachRate: row.decisions > 0 ? row.breaches / row.decisions : 0,
    })),
  };
}
