import {
  DEDUCTION_REASON_LABEL,
  type DeductionReason,
} from "@claimflow/contracts";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Donut } from "@/components/charts/Donut";
import { formatAmount } from "@/lib/format";
import type { DeductionsSummary } from "../deductions/api";

/** Fixed order so a reason's color never shifts as amounts change month to month. */
const REASON_ORDER: DeductionReason[] = [
  "missing_document",
  "documentation_delay",
  "incomplete_clinical_notes",
  "policy_mismatch",
  "other",
];

function colorVarFor(reason: DeductionReason): string {
  return `--series-${REASON_ORDER.indexOf(reason) + 1}`;
}

export function DeductionsByReasonCard({
  summary,
}: {
  summary: DeductionsSummary | undefined;
}) {
  const rows = summary?.byReason ?? [];
  const max = Math.max(1, ...rows.map((r) => r.total));
  const sortedRows = REASON_ORDER.map((reason) =>
    rows.find((r) => r.reason === reason),
  ).filter((r): r is NonNullable<typeof r> => r !== undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deductions by reason</CardTitle>
        <span className="text-2xs font-semibold uppercase tracking-[0.07em] text-ink-faint">
          This month
        </span>
      </CardHeader>

      {rows.length === 0 ? (
        <p className="px-1 py-2.5 text-base text-ink-faint">
          No deductions recorded this month. They&apos;re logged against a claim
          at settlement.
        </p>
      ) : (
        <>
          <Donut
            data={sortedRows.map((row) => ({
              key: row.reason,
              label: DEDUCTION_REASON_LABEL[row.reason],
              value: row.total,
              colorVar: colorVarFor(row.reason),
            }))}
            centerLabel="Total"
            formatValue={formatAmount}
          />

          <div className="flex flex-col gap-3.5 mt-4">
            {sortedRows.map((row) => (
              <div key={row.reason} className="flex flex-col gap-[5px]">
                <div className="flex justify-between text-base">
                  <span>{DEDUCTION_REASON_LABEL[row.reason]}</span>
                  <span className="font-semibold font-mono tabular-nums">
                    {formatAmount(row.total)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-[3px] bg-accent-soft">
                  <div
                    className="h-full rounded-[3px] bg-accent"
                    style={{
                      width: `${(row.total / max) * 100}%`,
                      background: `var(${colorVarFor(row.reason)})`,
                    }}
                  />
                </div>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-line pt-3 text-base font-semibold">
              <span>Total</span>
              <span className="font-mono tabular-nums">
                {formatAmount(summary!.total)}
              </span>
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
        </>
      )}
    </Card>
  );
}
