import { describe, expect, it } from "vitest";
import { canRetrySummarisation } from "./query-summarisation.js";

describe("canRetrySummarisation", () => {
  it("offers a retry on a failure that still has its email", () => {
    expect(
      canRetrySummarisation({
        summarisationStatus: "failed",
        tpaRawEmail: "Kindly send the Part B form.",
      }),
    ).toBe(true);
  });

  it("offers nothing on a summary that came back fine", () => {
    expect(
      canRetrySummarisation({
        summarisationStatus: "ok",
        tpaRawEmail: "Kindly send the Part B form.",
      }),
    ).toBe(false);
  });

  it("offers nothing when no attempt was made", () => {
    // Either the desk filled it in itself or no key is configured, and
    // a button press changes neither.
    expect(
      canRetrySummarisation({
        summarisationStatus: "not_attempted",
        tpaRawEmail: "Kindly send the Part B form.",
      }),
    ).toBe(false);
  });

  it("offers nothing when there is no email left to read", () => {
    expect(
      canRetrySummarisation({
        summarisationStatus: "failed",
        tpaRawEmail: null,
      }),
    ).toBe(false);
  });
});
