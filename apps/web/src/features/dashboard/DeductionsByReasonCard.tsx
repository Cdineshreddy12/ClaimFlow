import { DEDUCTION_REASON_LABEL } from "@claimflow/contracts";
import { formatAmount } from "@/lib/format";
import type { DeductionsSummary } from "../deductions/api";

export function DeductionsByReasonCard({
  summary,
}: {
  summary: DeductionsSummary | undefined;
}) {
  const rows = summary?.byReason ?? [];
  const max = Math.max(1, ...rows.map((r) => r.total));

  return (
    <div className="card card-pad">
      <div className="card-head">
        <h2 className="label-eyebrow">Deductions by reason</h2>
        <span className="label-eyebrow">This month</span>
      </div>

      {rows.length === 0 ? (
        <p className="empty-state">
          No deductions recorded this month. They&apos;re logged against a claim
          at settlement.
        </p>
      ) : (
        <div className="bar-list">
          {rows.map((row) => (
            <div key={row.reason} className="bar-row">
              <div className="bar-row-top">
                <span>{DEDUCTION_REASON_LABEL[row.reason]}</span>
                <span className="amt mono">{formatAmount(row.total)}</span>
              </div>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ width: `${(row.total / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
          <div className="bar-total">
            <span>Total</span>
            <span className="mono">{formatAmount(summary!.total)}</span>
          </div>
          {summary!.avoidableTotal > 0 ? (
            // The whole premise of the product: most of this is paperwork,
            // not clinical dispute. Naming the avoidable share makes the
            // number actionable rather than just depressing.
            <div className="mt-1 text-[12px] text-ink-faint">
              {formatAmount(summary!.avoidableTotal)} of this was avoidable —
              missing or late paperwork.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
