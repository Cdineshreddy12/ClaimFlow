import { describe, expect, it } from "vitest";
import {
  DecideEnhancementBody,
  ENHANCEMENT_ADVISORY_RATIO,
  RequestEnhancementBody,
  adviseEnhancement,
  isEnhancementOpen,
} from "./enhancement.js";

describe("RequestEnhancementBody", () => {
  it("requires a reason, because a blank one is a rejected enhancement", () => {
    const result = RequestEnhancementBody.safeParse({
      requestedAmount: 50_000,
      reason: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a zero or negative ask", () => {
    expect(
      RequestEnhancementBody.safeParse({ requestedAmount: 0, reason: "x" })
        .success,
    ).toBe(false);
    expect(
      RequestEnhancementBody.safeParse({ requestedAmount: -1, reason: "x" })
        .success,
    ).toBe(false);
  });

  it("accepts a real request", () => {
    const parsed = RequestEnhancementBody.parse({
      requestedAmount: "80000",
      reason: "Converted to open surgery; two extra ICU days.",
    });
    expect(parsed.requestedAmount).toBe(80_000);
  });
});

describe("DecideEnhancementBody", () => {
  it("needs the amount granted on an approval", () => {
    expect(
      DecideEnhancementBody.safeParse({ outcome: "APPROVED" }).success,
    ).toBe(false);
    expect(
      DecideEnhancementBody.safeParse({
        outcome: "PARTIALLY_APPROVED",
        approvedAmount: 50_000,
      }).success,
    ).toBe(true);
  });

  it("refuses an amount on a rejection, which would be a contradiction", () => {
    expect(
      DecideEnhancementBody.safeParse({
        outcome: "REJECTED",
        approvedAmount: 50_000,
      }).success,
    ).toBe(false);
    expect(
      DecideEnhancementBody.safeParse({ outcome: "REJECTED" }).success,
    ).toBe(true);
  });

  it("allows a zero approval, which is not the same as a rejection", () => {
    expect(
      DecideEnhancementBody.safeParse({
        outcome: "PARTIALLY_APPROVED",
        approvedAmount: 0,
      }).success,
    ).toBe(true);
  });
});

describe("isEnhancementOpen", () => {
  it("is only open while the insurer still owes an answer", () => {
    expect(isEnhancementOpen("REQUESTED")).toBe(true);
    for (const decided of [
      "APPROVED",
      "PARTIALLY_APPROVED",
      "REJECTED",
      "WITHDRAWN",
    ] as const) {
      expect(isEnhancementOpen(decided)).toBe(false);
    }
  });
});

describe("adviseEnhancement", () => {
  const base = {
    sanctionedAmount: 200_000,
    costOnRecord: 100_000,
    claimIsOpen: true,
    hasPendingEnhancement: false,
  };

  it("says nothing while there's comfortable headroom", () => {
    const advice = adviseEnhancement(base);
    expect(advice.advised).toBe(false);
    expect(advice.reason).toBeNull();
  });

  it("advises before the ceiling is reached, not after", () => {
    // 80% of 200,000 — the whole point is to be early enough to matter.
    const advice = adviseEnhancement({ ...base, costOnRecord: 160_000 });
    expect(advice.advised).toBe(true);
    expect(advice.reason).toContain("80%");
    expect(ENHANCEMENT_ADVISORY_RATIO).toBe(0.8);
  });

  it("says plainly when cost has already passed the sanction", () => {
    const advice = adviseEnhancement({ ...base, costOnRecord: 240_000 });
    expect(advice.advised).toBe(true);
    expect(advice.reason).toContain("passed");
    // The gap (40,000) plus the margin that triggered the advice (40,000).
    expect(advice.suggestedAmount).toBe(80_000);
  });

  it("suggests at least the margin when the ceiling is merely close", () => {
    const advice = adviseEnhancement({ ...base, costOnRecord: 170_000 });
    expect(advice.suggestedAmount).toBe(40_000);
  });

  it("stays quiet while one is already with the insurer", () => {
    const advice = adviseEnhancement({
      ...base,
      costOnRecord: 240_000,
      hasPendingEnhancement: true,
    });
    expect(advice.advised).toBe(false);
    expect(advice.pending).toBe(true);
    expect(advice.reason).toContain("already with the insurer");
  });

  it("stays quiet on a closed claim, where it would only be a reproach", () => {
    const advice = adviseEnhancement({
      ...base,
      costOnRecord: 240_000,
      claimIsOpen: false,
    });
    expect(advice.advised).toBe(false);
  });

  it("says nothing when there is no ceiling or no cost to compare", () => {
    expect(adviseEnhancement({ ...base, sanctionedAmount: null }).advised).toBe(
      false,
    );
    expect(adviseEnhancement({ ...base, costOnRecord: null }).advised).toBe(
      false,
    );
    // A zero sanction is "not recorded", not "a ceiling of nothing".
    expect(adviseEnhancement({ ...base, sanctionedAmount: 0 }).advised).toBe(
      false,
    );
  });
});
