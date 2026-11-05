import { describe, expect, it } from "vitest";
import { fromLocalInput, toLocalInput } from "./deadline";

describe("toLocalInput", () => {
  it("returns an empty field when there's no deadline", () => {
    expect(toLocalInput(null)).toBe("");
  });

  it("drops seconds and the offset, which the input has no slot for", () => {
    const iso = new Date(2026, 10, 6, 18, 30, 45).toISOString();
    expect(toLocalInput(iso)).toBe("2026-11-06T18:30");
  });

  it("ignores a value the API couldn't have sent rather than rendering NaN", () => {
    expect(toLocalInput("not a date")).toBe("");
  });
});

describe("fromLocalInput", () => {
  /**
   * The round trip is the contract: whatever the desk sees in the input
   * is the instant that gets stored, in whatever timezone they're in.
   */
  it("round-trips through the browser's own timezone", () => {
    const iso = new Date(2026, 10, 6, 18, 30).toISOString();
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
  });

  it("reads an empty field as 'there is no deadline', not as a failure", () => {
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("   ")).toBeNull();
  });

  it("refuses an unparseable value instead of sending Invalid Date", () => {
    expect(fromLocalInput("2026-13-45T99:99")).toBeNull();
  });
});
