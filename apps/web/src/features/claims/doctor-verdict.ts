import type { DoctorApprovalRequest } from "./api";

/**
 * Where a claim stands with its treating doctor, as one answer.
 *
 * A claim can carry several links — a first one that expired unopened,
 * a second to a different doctor, a third after a note was replaced —
 * and until now the only place any of that appeared was inside the
 * dialog you open by clicking "Ask a doctor". So a doctor could decline
 * a note, give a reason, and the desk could submit the claim without
 * ever seeing it (docs/adr/0010 records the decision but surfaces it
 * nowhere).
 *
 * The latest decision wins, not the worst one. A doctor who declines a
 * note and approves the replacement has approved it, and showing the
 * old refusal alongside would teach the desk to ignore both.
 */
export type DoctorVerdict =
  | { kind: "none" }
  | { kind: "awaiting"; doctorName: string; viewed: boolean }
  | { kind: "expired"; doctorName: string }
  | { kind: "approved"; doctorName: string; at: string }
  | { kind: "declined"; doctorName: string; at: string; reason: string | null };

function decidedAt(a: DoctorApprovalRequest): string | null {
  return a.declinedAt ?? a.approvedAt ?? null;
}

export function doctorVerdict(
  approvals: DoctorApprovalRequest[] | undefined,
  now: Date = new Date(),
): DoctorVerdict {
  if (!approvals || approvals.length === 0) return { kind: "none" };

  const decided = approvals
    .filter((a) => decidedAt(a) !== null)
    .sort((a, b) => (decidedAt(b) ?? "").localeCompare(decidedAt(a) ?? ""));

  const latest = decided[0];
  if (latest) {
    return latest.declinedAt
      ? {
          kind: "declined",
          doctorName: latest.doctorName,
          at: latest.declinedAt,
          reason: latest.declineReason,
        }
      : {
          kind: "approved",
          doctorName: latest.doctorName,
          at: latest.approvedAt!,
        };
  }

  // Nothing decided. A live link is a different state from a dead one:
  // one is worth waiting for, the other needs sending again.
  const live = approvals
    .filter((a) => new Date(a.expiresAt) > now)
    .sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))[0];

  if (live) {
    return {
      kind: "awaiting",
      doctorName: live.doctorName,
      // Opened but not answered is the case worth naming — it means the
      // link reached them and the question is still open, rather than
      // sitting unread in a WhatsApp thread.
      viewed: live.firstViewedAt !== null,
    };
  }

  return { kind: "expired", doctorName: approvals[0]!.doctorName };
}
