import { useState } from "react";

export interface ColumnDatum {
  key: string;
  label: string;
  value: number;
}

/**
 * A single-series column chart — one hue, no legend needed (the card
 * title names the series). Each column caps with a compact direct label;
 * the full value lives in the hover/focus tooltip, which every value is
 * already reachable without — the label just abbreviates.
 */
export function ColumnChart({
  data,
  formatValue = (v) => String(v),
  formatTooltipValue = formatValue,
  height = 120,
}: {
  data: ColumnDatum[];
  formatValue?: (value: number) => string;
  formatTooltipValue?: (value: number) => string;
  height?: number;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <div
      className="flex items-end gap-1 border-b border-line pt-7"
      style={{ height }}
    >
      {data.map((d) => (
        <button
          key={d.key}
          type="button"
          className="relative flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-end border-0 bg-transparent px-1 font-[inherit] text-inherit"
          onMouseEnter={() => setHovered(d.key)}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered(d.key)}
          onBlur={() => setHovered(null)}
        >
          {hovered === d.key ? (
            <div className="pointer-events-none absolute bottom-full left-1/2 z-[5] -translate-x-1/2 -translate-y-2 whitespace-nowrap rounded-sm border border-line-strong bg-surface-raised px-2.5 py-1.5 text-sm shadow-raised">
              <div className="font-[650] tabular-nums">
                {formatTooltipValue(d.value)}
              </div>
              <div className="mt-px text-ink-faint">{d.label}</div>
            </div>
          ) : null}
          <div className="mb-1.5 whitespace-nowrap text-2xs font-semibold tabular-nums text-ink-soft">
            {formatValue(d.value)}
          </div>
          <div
            className={`min-h-0.5 w-full max-w-[28px] rounded-t bg-accent transition-opacity ${
              hovered && hovered !== d.key ? "opacity-40" : "opacity-100"
            }`}
            style={{
              height: `${Math.max((d.value / max) * (height - 40), 2)}px`,
            }}
          />
          <div className="mt-2 pb-2.5 text-2xs text-ink-faint">{d.label}</div>
        </button>
      ))}
    </div>
  );
}
