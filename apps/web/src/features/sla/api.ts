import { useQuery } from "@tanstack/react-query";
import type { ClaimStatus, SlaOwner, SlaState } from "@claimflow/contracts";
import { api } from "@/lib/api-client";

export interface SlaWatchItem {
  claimId: string;
  reference: string;
  patientName: string;
  insurerName: string;
  status: ClaimStatus;
  enteredAt: string;
  slaDeadline: string | null;
  state: SlaState;
  remainingMs: number | null;
  owedBy: SlaOwner | null;
  basis: string | null;
}

export interface SlaWatch {
  items: SlaWatchItem[];
  breached: number;
  dueSoon: number;
  breachedOnInsurer: number;
}

export interface TurnaroundRow {
  insurerName: string;
  fromStatus: ClaimStatus;
  decisions: number;
  avgHours: number;
  worstHours: number;
  breaches: number;
  targetHours: number | null;
  breachRate: number;
}

export interface DeskTurnaroundRow {
  fromStatus: string;
  /** The work, not the state — "Opened → pre-auth sent". */
  label: string;
  handovers: number;
  avgHours: number;
  worstHours: number;
}

export interface TurnaroundReport {
  since: string;
  rows: TurnaroundRow[];
  /** The same question asked about us. */
  desk: DeskTurnaroundRow[];
}

/**
 * Polled, unlike every other query here. This is a countdown: a desk
 * exec watching a patient wait at discharge needs the number on screen
 * to be the number now, and a stale "12 minutes left" is worse than no
 * clock at all.
 */
export function useSlaWatch() {
  return useQuery({
    queryKey: ["sla", "watch"],
    queryFn: () => api.get<SlaWatch>("/sla/watch"),
    refetchInterval: 60_000,
  });
}

export function useTurnaround() {
  return useQuery({
    queryKey: ["sla", "turnaround"],
    queryFn: () => api.get<TurnaroundReport>("/sla/turnaround"),
  });
}
