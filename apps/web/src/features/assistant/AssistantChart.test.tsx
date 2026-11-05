import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssistantChart, parseChartSpec } from "./AssistantChart";

describe("parseChartSpec", () => {
  it("accepts a well-formed spec", () => {
    expect(
      parseChartSpec(
        '{"type":"bar","title":"Deductions","unit":"currency","data":[{"label":"Missing document","value":42000}]}',
      ),
    ).toMatchObject({ type: "bar", unit: "currency" });
  });

  it("refuses anything it can't draw honestly", () => {
    // A broken spec falls through to an ordinary code block, where the
    // text is at least still readable.
    expect(parseChartSpec("not json")).toBeNull();
    expect(parseChartSpec('{"type":"pie","data":[]}')).toBeNull();
    expect(parseChartSpec('{"type":"bar","data":[]}')).toBeNull();
    expect(
      parseChartSpec('{"type":"bar","data":[{"label":"x","value":"lots"}]}'),
    ).toBeNull();
  });

  it("drops rows that aren't numbers rather than plotting NaN", () => {
    const spec = parseChartSpec(
      '{"type":"bar","data":[{"label":"a","value":1},{"label":"b","value":null}]}',
    );
    expect(spec?.data).toHaveLength(1);
  });

  it("caps at the palette's width", () => {
    const data = Array.from({ length: 20 }, (_, i) => ({
      label: `r${i}`,
      value: i + 1,
    }));
    const spec = parseChartSpec(JSON.stringify({ type: "bar", data }));
    expect(spec?.data).toHaveLength(8);
  });
});

describe("AssistantChart", () => {
  /**
   * Every plotted number is printed beside its mark. That is what makes
   * a fabricated figure visible instead of hidden in a shape — and it
   * is also what discharges this palette's light-mode contrast warning.
   */
  it("prints each value next to its bar", () => {
    render(
      <AssistantChart
        spec={{
          type: "bar",
          title: "Deductions by reason",
          unit: "currency",
          data: [
            { label: "Missing document", value: 42000 },
            { label: "Documentation delay", value: 18000 },
          ],
        }}
      />,
    );

    expect(screen.getByText("Deductions by reason")).toBeInTheDocument();
    expect(screen.getByText("Missing document")).toBeInTheDocument();
    expect(screen.getByText("₹42,000")).toBeInTheDocument();
    expect(screen.getByText("₹18,000")).toBeInTheDocument();
  });

  it("gives a donut a legend, so identity is never colour alone", () => {
    render(
      <AssistantChart
        spec={{
          type: "donut",
          unit: "count",
          data: [
            { label: "Pre-auth sent", value: 3 },
            { label: "Settled", value: 5 },
          ],
        }}
      />,
    );

    // Donut's own legend: one button per slice, labelled and valued.
    expect(
      screen.getByRole("button", { name: /Pre-auth sent/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Settled/ })).toBeInTheDocument();
  });
});
