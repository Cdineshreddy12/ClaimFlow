import { useQuery } from "@tanstack/react-query";
import type { ClaimStatus, DeductionReason } from "@claimflow/contracts";
import { api } from "@/lib/api-client";

export interface PeriodClaimsSummary {
  opened: number;
  settled: number;
  settledValue: number;
  avgTatDays: number | null;
}

export interface DeductionsSummary {
  total: number;
  avoidableTotal: number;
  recoveredTotal: number;
  byReason: {
    reason: DeductionReason;
    total: number;
    count: number;
    recovered: number;
  }[];
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

export interface PeriodReport {
  from: string;
  to: string;
  claims: PeriodClaimsSummary;
  deductions: DeductionsSummary;
  turnaround: { since: string; rows: TurnaroundRow[] };
}

export function usePeriodReport(month: string) {
  return useQuery({
    queryKey: ["reports", "period", month],
    queryFn: () => api.get<PeriodReport>(`/reports/period?month=${month}`),
  });
}

/**
 * Fetched as a blob rather than linked directly: the endpoint needs the
 * Authorization header, which a plain <a href> can't send — same
 * reasoning as `downloadPreauthForm` in claims/api.ts.
 */
export async function downloadPeriodReportPdf(month: string) {
  const blob = await api.getBlob(`/reports/period.pdf?month=${month}`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `claimflow-report-${month}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
