import { useState } from "react";

export interface DonutDatum {
  key: string;
  label: string;
  value: number;
  /** A `--series-N` (or other) CSS custom property name, e.g. "--series-3". */
  colorVar: string;
}

/**
 * A ring of fixed-order categorical slices with a synced legend — hovering
 * or focusing either a slice or its legend row highlights both and swaps
 * the center readout to that slice's value, so the detail is reachable by
 * mouse or keyboard without a floating tooltip.
 *
 * Slice order and color are the caller's responsibility (assign by a fixed
 * index, never by sorted rank) — this component only draws what it's given.
 */
export function Donut({
  data,
  size = 132,
  strokeWidth = 20,
  centerLabel,
  formatValue = (v) => String(v),
}: {
  data: DonutDatum[];
  size?: number;
  strokeWidth?: number;
  centerLabel: string;
  formatValue?: (value: number) => string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const gap = 2;

  const active = data.find((d) => d.key === hovered) ?? null;

  // The center readout swaps between a slice's value and the grand total,
  // and those can be wildly different lengths ("3" vs "₹4,80,006") — a
  // fixed font size either wastes the hole on a single digit or runs the
  // total straight into the ring. Size it to the text instead.
  const centerText = active ? formatValue(active.value) : formatValue(total);
  const holeDiameter = size - 2 * strokeWidth;
  const centerFontSize = Math.min(
    20,
    Math.max(11, (holeDiameter * 0.78) / (centerText.length * 0.6)),
  );

  let cumulative = 0;
  const segments = data.map((d) => {
    const fraction = total > 0 ? d.value / total : 0;
    const full = fraction * circumference;
    const dashLength = Math.max(full - gap, 0);
    const offset = -cumulative;
    cumulative += full;
    return { ...d, fraction, dashLength, offset };
  });

  return (
    <div className="flex flex-col items-center gap-5">
      <div
        className="relative shrink-0 [&_svg]:block [&_svg]:-rotate-90"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {segments.map((seg) => (
            <circle
              key={seg.key}
              className={`cursor-pointer transition-opacity ${
                hovered && hovered !== seg.key ? "opacity-35" : "opacity-100"
              }`}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={`var(${seg.colorVar})`}
              strokeWidth={strokeWidth}
              strokeDasharray={`${seg.dashLength} ${circumference - seg.dashLength}`}
              strokeDashoffset={seg.offset}
              tabIndex={0}
              role="img"
              aria-label={`${seg.label}: ${formatValue(seg.value)} (${Math.round(seg.fraction * 100)}%)`}
              onMouseEnter={() => setHovered(seg.key)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(seg.key)}
              onBlur={() => setHovered(null)}
            />
          ))}
        </svg>
        <div
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"
          style={{ paddingInline: strokeWidth * 0.6 }}
        >
          <div
            className="font-[650] tracking-[-0.01em] font-mono tabular-nums"
            style={{ fontSize: centerFontSize }}
          >
            {centerText}
          </div>
          <div className="mt-0.5 text-2xs font-semibold uppercase tracking-[0.05em] text-ink-faint">
            {active ? active.label : centerLabel}
          </div>
        </div>
      </div>

      <div className="flex w-full flex-col gap-0.5">
        {segments.map((seg) => (
          <button
            key={seg.key}
            type="button"
            className={`flex cursor-pointer items-center justify-between gap-2.5 rounded-sm border-0 bg-transparent px-1.5 py-[5px] text-left font-[inherit] text-inherit transition-opacity hover:bg-hover focus-visible:bg-hover ${
              hovered && hovered !== seg.key ? "opacity-45" : "opacity-100"
            }`}
            onMouseEnter={() => setHovered(seg.key)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(seg.key)}
            onBlur={() => setHovered(null)}
          >
            <span className="flex min-w-0 items-center gap-2 text-base [&_span]:overflow-hidden [&_span]:text-ellipsis [&_span]:whitespace-nowrap">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: `var(${seg.colorVar})` }}
              />
              <span>{seg.label}</span>
            </span>
            <span className="flex shrink-0 items-baseline gap-1.5">
              <span className="font-mono tabular-nums">
                {formatValue(seg.value)}
              </span>
              <span className="min-w-[2.4em] text-right text-2xs text-ink-faint">
                {total > 0 ? `${Math.round(seg.fraction * 100)}%` : "0%"}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
