import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ColumnChart } from "@/components/charts/ColumnChart";
import { formatAmount, formatCompactAmount } from "@/lib/format";
import type { Claim } from "../claims/types";

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

/** The trailing 6 calendar months, oldest first, including the current one. */
function trailingMonths(now: number): { year: number; month: number }[] {
  const anchor = new Date(now);
  const months: { year: number; month: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() });
  }
  return months;
}

export function SettledTrendChart({
  claims,
  now,
}: {
  claims: Claim[];
  now: number;
}) {
  const months = trailingMonths(now);

  const data = months.map(({ year, month }) => {
    const total = claims
      .filter((c) => {
        if (!c.settledOn) return false;
        const d = new Date(`${c.settledOn}T00:00:00`);
        return d.getFullYear() === year && d.getMonth() === month;
      })
      .reduce((sum, c) => sum + Number(c.settledAmount ?? 0), 0);

    return {
      key: `${year}-${month}`,
      label: MONTH_LABEL[month] ?? "",
      value: total,
    };
  });

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
