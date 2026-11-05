import { BarChart } from "../../components/charts/BarChart";
import { Donut } from "../../components/charts/Donut";
import { formatAmount } from "../../lib/format";

/**
 * A chart the assistant asked for.
 *
 * It emits a fenced ```chart block holding a small JSON spec, and this
 * renders it with the same primitives the dashboard uses — same hues,
 * same light and dark behaviour, nothing new to validate.
 *
 * Deliberately a narrow spec. The model is good at deciding that a
 * shape would help and which numbers belong in it; it is not the right
 * thing to be choosing axis ranges or colours, and a spec wide enough
 * to let it would be a spec wide enough to let it make something
 * unreadable. So: a title, a unit, and labelled values.
 *
 * Every number it plots came out of a tool moments earlier, and is
 * printed next to its bar — so a fabricated value is visible rather
 * than hidden inside a shape.
 */

interface ChartSpec {
  type: "bar" | "donut";
  title?: string;
  unit?: "currency" | "count" | "hours" | "percent";
  data: { label: string; value: number }[];
}

/** Returns null for anything malformed — a broken chart becomes its own code block. */
export function parseChartSpec(source: string): ChartSpec | null {
  try {
    const raw = JSON.parse(source) as Partial<ChartSpec>;
    if (raw.type !== "bar" && raw.type !== "donut") return null;
    if (!Array.isArray(raw.data) || raw.data.length === 0) return null;
    const data = raw.data
      .filter(
        (d): d is { label: string; value: number } =>
          typeof d?.label === "string" && Number.isFinite(d?.value),
      )
      // Eight is the palette's width, and more rows than that in a
      // panel this size is a table's job.
      .slice(0, 8);
    if (data.length === 0) return null;
    return {
      type: raw.type,
      ...(raw.title ? { title: raw.title } : {}),
      ...(raw.unit ? { unit: raw.unit } : {}),
      data,
    };
  } catch {
    return null;
  }
}

function formatterFor(unit: ChartSpec["unit"]): (value: number) => string {
  switch (unit) {
    case "currency":
      // formatAmount already carries the symbol.
      return (v) => formatAmount(v);
    case "hours":
      return (v) => `${Math.round(v)}h`;
    case "percent":
      return (v) => `${Math.round(v)}%`;
    default:
      return (v) => v.toLocaleString("en-IN");
  }
}

export function AssistantChart({ spec }: { spec: ChartSpec }) {
  const format = formatterFor(spec.unit);

  return (
    <figure className="m-0 mb-2 rounded-md border border-line bg-surface-raised px-3 py-2.5 last:mb-0">
      {spec.title ? (
        <figcaption className="mb-2 text-2xs font-semibold uppercase tracking-[0.05em] text-ink-faint">
          {spec.title}
        </figcaption>
      ) : null}

      {spec.type === "donut" ? (
        // Donut brings its own legend, with each slice's value and
        // share — identity is never colour alone, and a second legend
        // here would just say everything twice.
        <Donut
          data={spec.data.map((d, i) => ({
            key: `${d.label}-${i}`,
            label: d.label,
            value: d.value,
            // Fixed order by index, never by rank — the rule the
            // dashboard's donut follows, for the same reason.
            colorVar: `--series-${(i % 8) + 1}`,
          }))}
          centerLabel={String(spec.data.length)}
          formatValue={format}
        />
      ) : (
        <BarChart
          data={spec.data.map((d, i) => ({
            key: `${d.label}-${i}`,
            label: d.label,
            value: d.value,
          }))}
          formatValue={format}
        />
      )}
    </figure>
  );
}
