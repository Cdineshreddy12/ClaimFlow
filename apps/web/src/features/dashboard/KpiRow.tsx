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
    <div className="kpi-row">
      <div className="kpi">
        <div className="kpi-label">Open Claims</div>
        <div className="kpi-value">{metrics.openClaims}</div>
        <div className="kpi-trend">
          Across pre-auth, query &amp; enhancement
        </div>
      </div>

      <div className={`kpi${metrics.needsAttention > 0 ? " is-critical" : ""}`}>
        <div className="kpi-label">Needs Attention</div>
        <div className="kpi-value">{metrics.needsAttention}</div>
        <div className={`kpi-trend${metrics.needsAttention > 0 ? " bad" : ""}`}>
          Open query or enhancement
        </div>
      </div>

      <div className="kpi">
        <div className="kpi-label">Deductions, This Month</div>
        <div className="kpi-value mono">
          {deductions ? formatAmount(deductions.total) : "—"}
        </div>
        <div className="kpi-trend">
          {deductions && deductions.avoidableTotal > 0
            ? `${formatAmount(deductions.avoidableTotal)} avoidable`
            : "Nothing recorded yet"}
        </div>
      </div>

      <div className={`kpi${metrics.overdueQueries > 0 ? " is-critical" : ""}`}>
        <div className="kpi-label">Open Queries</div>
        <div className="kpi-value mono">{metrics.openQueries}</div>
        <div className={`kpi-trend${metrics.overdueQueries > 0 ? " bad" : ""}`}>
          {metrics.overdueQueries > 0
            ? `${metrics.overdueQueries} overdue for reply`
            : "None overdue"}
        </div>
      </div>
    </div>
  );
}
