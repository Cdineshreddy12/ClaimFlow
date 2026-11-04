import { describe, expect, it } from "vitest";
import { formatCountdown } from "./countdown";

const NOW = new Date("2026-11-04T12:00:00Z").getTime();

describe("formatCountdown", () => {
  it("returns null when there's no deadline", () => {
    expect(formatCountdown(null, NOW)).toBeNull();
  });

  it("marks a past deadline as overdue with a minus sign", () => {
    const deadline = new Date(NOW - 6 * 3_600_000).toISOString();
    const result = formatCountdown(deadline, NOW);
    expect(result).toMatchObject({
      isOverdue: true,
      label: "Reply window closed",
    });
    expect(result?.text).toBe("−6h 00m");
  });

  it("marks a future deadline as not overdue with a plus sign", () => {
    const deadline = new Date(NOW + 18 * 3_600_000).toISOString();
    const result = formatCountdown(deadline, NOW);
    expect(result).toMatchObject({
      isOverdue: false,
      label: "Reply window closes in",
    });
    expect(result?.text).toBe("+18h 00m");
  });
});
