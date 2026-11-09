import { describe, expect, it } from "vitest";
import { formatAdmission, formatDuration, formatTimeLeft } from "./format";

describe("formatAdmission", () => {
  it("drops the time when only a date is known", () => {
    // "Date of admission" and "Time of admission" are separate fields
    // on the pre-auth form. Confirming only the date stores midnight,
    // and printing that as "12:00 am" gave the claim an admission time
    // nobody entered — on a line the desk quotes back to an insurer.
    const midnight = new Date(2026, 10, 7, 0, 0, 0).toISOString();
    const out = formatAdmission(midnight);

    expect(out).not.toMatch(/12:00/);
    expect(out).toMatch(/7 Nov 2026/);
  });

  it("keeps the time when there is one", () => {
    const admitted = new Date(2026, 10, 7, 9, 40, 0).toISOString();
    const out = formatAdmission(admitted);

    expect(out).toMatch(/7 Nov 2026/);
    expect(out).toMatch(/9:40/);
  });

  it("shows an em dash rather than inventing a date", () => {
    expect(formatAdmission(null)).toBe("—");
    expect(formatAdmission(undefined)).toBe("—");
    expect(formatAdmission("not a date")).toBe("—");
  });
});

/**
 * The countdown formatter is separate from `formatDuration` because
 * the two answer different questions, and the tests here are mostly
 * about keeping them apart.
 */
describe("formatTimeLeft", () => {
  const s = (n: number) => n * 1000;
  const m = (n: number) => n * 60_000;
  const h = (n: number) => n * 3_600_000;

  it("shows seconds under an hour, so the clock visibly runs", () => {
    expect(formatTimeLeft(m(6) + s(44))).toBe("6m 44s");
    expect(formatTimeLeft(s(38))).toBe("38s");
  });

  it("pads seconds, so the width doesn't jump every ten ticks", () => {
    expect(formatTimeLeft(m(5) + s(4))).toBe("5m 04s");
  });

  it("drops to minutes once an hour is in play", () => {
    // An IRDAI discharge window is three hours; seconds on it would be
    // noise until the end, and it starts ticking when it matters.
    expect(formatTimeLeft(h(2) + m(47) + s(30))).toBe("2h 47m");
  });

  it("drops to hours past a day", () => {
    expect(formatTimeLeft(h(38) + m(12))).toBe("1d 14h");
  });

  it("reads an overdue duration the same, the sign being the caller's job", () => {
    expect(formatTimeLeft(-(m(6) + s(44)))).toBe("6m 44s");
  });

  it("leaves formatDuration alone, which measures age and wants no seconds", () => {
    // "3d 4h 12s" on a how-long-has-this-sat column is noise.
    expect(formatDuration(m(6) + s(44))).toBe("6m");
    expect(formatDuration(h(38) + m(12))).toBe("1d 14h");
  });
});
