import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ColumnChart } from "@/components/charts/ColumnChart";
import { formatAmount, formatCompactAmount } from "@/lib/format";
import type { SettledMonth } from "@claimflow/contracts";

const MONTH_LABEL = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function SettledTrendChart({
  months,
}: {
  /**
   * Six months, summed in the database and already gap-filled — a
   * quiet month still gets a column, so the chart reads as a quieter
   * month rather than a shorter history.
   */
  months: SettledMonth[];
}) {
  const data = months.map(({ year, month, value }) => ({
    key: `${year}-${month}`,
    label: MONTH_LABEL[month] ?? "",
    value,
  }));

  const hasAny = data.some((d) => d.value > 0);

  return (
    <Card className="mt-5">
      <CardHeader>
        <CardTitle>Settled value, last 6 months</CardTitle>
      </CardHeader>

      {hasAny ? (
        <ColumnChart
          data={data}
          formatValue={(v) => (v > 0 ? formatCompactAmount(v) : "")}
          formatTooltipValue={formatAmount}
        />
      ) : (
        <p className="px-1 py-2.5 text-base text-ink-faint">
          Nothing settled in this window yet.
        </p>
      )}
    </Card>
  );
}
