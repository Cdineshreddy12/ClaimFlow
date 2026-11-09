import { describe, expect, it } from "vitest";
import { formatAdmission } from "./format";

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
