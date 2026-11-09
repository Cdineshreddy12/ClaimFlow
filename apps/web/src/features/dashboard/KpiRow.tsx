import { formatAmount } from "@/lib/format";
import type { DeductionsSummary } from "../deductions/api";
import type { DashboardMetrics } from "./metrics";

export function KpiRow({
  metrics,
  deductions,
}: {
  metrics: DashboardMetrics;
  deductions: DeductionsSummary | undefined;
}) {
  return (
    <div className="mb-6 grid grid-cols-1 gap-4 sm:[grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
      <div className="rounded-lg border border-line bg-surface-raised px-[18px] py-4 shadow-card">
        <div className="text-xs font-semibold uppercase tracking-[0.05em] text-ink-faint">
          Open Claims
        </div>
        <div className="mt-2 text-2xl font-[650] tracking-[-0.02em] tabular-nums">
          {metrics.openClaims}
        </div>
        <div className="mt-1.5 text-sm text-ink-soft">
          Across pre-auth, query &amp; enhancement
        </div>
      </div>

      <div
        className={`rounded-lg border border-line bg-surface-raised px-[18px] py-4 shadow-card${metrics.needsAttention > 0 ? " border-t-2 border-t-critical pt-[15px]" : ""}`}
      >
        <div className="text-xs font-semibold uppercase tracking-[0.05em] text-ink-faint">
          Needs Attention
        </div>
        <div className="mt-2 text-2xl font-[650] tracking-[-0.02em] tabular-nums">
          {metrics.needsAttention}
        </div>
        <div
          className={`mt-1.5 text-sm text-ink-soft${metrics.needsAttention > 0 ? " bad" : ""}`}
        >
          Open query or enhancement
        </div>
      </div>

      {/* The counterweight. Four cards all counting problems made the
          desk look like it was only ever losing; this is the work that
          actually finished. */}
      <div className="rounded-lg border border-line bg-surface-raised px-[18px] py-4 shadow-card">
        <div className="text-xs font-semibold uppercase tracking-[0.05em] text-ink-faint">
          Paid, This Month
        </div>
        <div className="mt-2 text-2xl font-[650] tracking-[-0.02em] tabular-nums">
          {metrics.paidThisMonth}
        </div>
        <div className="mt-1.5 text-sm text-ink-soft">
          {metrics.settledValueThisMonth > 0
            ? `${formatAmount(String(metrics.settledValueThisMonth))} received`
            : "Nothing paid yet this month"}
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface-raised px-[18px] py-4 shadow-card">
        <div className="text-xs font-semibold uppercase tracking-[0.05em] text-ink-faint">
          Deductions, This Month
        </div>
        <div className="mt-2 text-2xl font-[650] tracking-[-0.02em] tabular-nums font-mono tabular-nums">
          {deductions ? formatAmount(deductions.total) : "—"}
        </div>
        <div className="mt-1.5 text-sm text-ink-soft">
          {/* Recovered wins the slot when there is any: money clawed
              back is the newer and better fact, and the avoidable share
              is still on the breakdown card below. */}
          {deductions && deductions.recoveredTotal > 0
            ? `${formatAmount(deductions.recoveredTotal)} recovered on appeal`
            : deductions && deductions.avoidableTotal > 0
              ? `${formatAmount(deductions.avoidableTotal)} avoidable`
              : "Nothing recorded yet"}
        </div>
      </div>

      <div
        className={`rounded-lg border border-line bg-surface-raised px-[18px] py-4 shadow-card${metrics.overdueQueries > 0 ? " border-t-2 border-t-critical pt-[15px]" : ""}`}
      >
        <div className="text-xs font-semibold uppercase tracking-[0.05em] text-ink-faint">
          Open Queries
        </div>
        <div className="mt-2 text-2xl font-[650] tracking-[-0.02em] tabular-nums font-mono tabular-nums">
          {metrics.openQueries}
        </div>
        <div
          className={`mt-1.5 text-sm text-ink-soft${metrics.overdueQueries > 0 ? " bad" : ""}`}
        >
          {metrics.overdueQueries > 0
            ? `${metrics.overdueQueries} overdue for reply`
            : "None overdue"}
        </div>
      </div>
    </div>
  );
}
