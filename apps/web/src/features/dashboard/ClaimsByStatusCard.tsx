import type { DashboardMetrics } from "./metrics";

export function ClaimsByStatusCard({
  byStatus,
}: {
  byStatus: DashboardMetrics["byStatus"];
}) {
  const max = Math.max(1, ...byStatus.map((s) => s.count));
  const total = byStatus.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="card card-pad">
      <div className="card-head">
        <h2 className="label-eyebrow">Claims by Status</h2>
      </div>
      {byStatus.length === 0 ? (
        <p className="empty-state">No claims yet.</p>
      ) : (
        <div className="bar-list">
          {byStatus.map((s) => (
            <div key={s.status} className="bar-row">
              <div className="bar-row-top">
                <span>{s.label}</span>
                <span className="amt mono">{s.count}</span>
              </div>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ width: `${(s.count / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
          <div className="bar-total">
            <span>Total</span>
            <span className="mono">{total}</span>
          </div>
        </div>
      )}
    </div>
  );
}
