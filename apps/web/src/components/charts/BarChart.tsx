export interface BarDatum {
  key: string;
  label: string;
  value: number;
}

/**
 * A single-series horizontal bar chart.
 *
 * Horizontal because the categories here are phrases — "Documentation
 * delay", "Star Health Insurance" — and a vertical column chart either
 * truncates them or turns them on their side. Rows give a label the
 * width it needs and cost nothing but height.
 *
 * One hue, not eight. Colour carries identity, and in a single-measure
 * chart the bars have no identity to carry beyond the label already
 * next to them — a hue per bar would be decoration pretending to be
 * information.
 *
 * Every bar is directly labelled with its value. That is also what
 * discharges the light-mode contrast warning on this palette: the
 * number is readable whether or not the fill is.
 */
export function BarChart({
  data,
  formatValue = (v) => String(v),
  emphasise,
}: {
  data: BarDatum[];
  formatValue?: (value: number) => string;
  /** Keys to draw in the warning hue — the share a desk is meant to act on. */
  emphasise?: Set<string>;
}) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));

  return (
    <div className="flex flex-col gap-1.5">
      {data.map((d) => {
        const share = Math.abs(d.value) / max;
        const flagged = emphasise?.has(d.key) ?? false;
        return (
          <div
            key={d.key}
            className="grid grid-cols-[minmax(0,11rem)_1fr] items-center gap-2"
          >
            <div className="truncate text-sm text-ink-soft" title={d.label}>
              {d.label}
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4 min-w-0 flex-1">
                <div
                  // 4px rounded data-end, anchored at the baseline; a
                  // zero-value row still shows a sliver so the row
                  // doesn't read as missing data.
                  className="h-full rounded-r-[4px]"
                  style={{
                    width: `${Math.max(share * 100, 0.75)}%`,
                    background: flagged ? "var(--pending)" : "var(--series-1)",
                  }}
                />
              </div>
              <div className="shrink-0 font-mono text-sm tabular-nums text-ink">
                {formatValue(d.value)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
