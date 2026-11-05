import { describe, expect, it } from "vitest";
import type { DeductionRisk } from "@claimflow/contracts";
import {
  describeScope,
  formatRate,
  formatRatePercent,
  isUrgent,
  riskAction,
} from "./risk";

function risk(over: Partial<DeductionRisk> = {}): DeductionRisk {
  return {
    reason: "missing_document",
    avoidable: true,
    claimsAffected: 7,
    claimsConsidered: 12,
    historicalTotal: 210_000,
    recoveredTotal: 0,
    netTotal: 210_000,
    averagePerClaim: 30_000,
    expectedCost: 17_500,
    openGaps: [],
    ...over,
  };
}

describe("formatRate", () => {
  it("keeps the denominator in the sentence", () => {
    expect(formatRate(risk())).toBe("7 of the last 12");
  });
});

describe("formatRatePercent", () => {
  it("rounds to whole percent", () => {
    expect(formatRatePercent(risk())).toBe("58%");
  });

  it("doesn't divide by an empty history", () => {
    expect(
      formatRatePercent(risk({ claimsAffected: 0, claimsConsidered: 0 })),
    ).toBe("—");
  });
});

describe("describeScope", () => {
  it("names the procedure when the history was that specific", () => {
    expect(
      describeScope("insurer_procedure", "Star Health", "Cholecystectomy"),
    ).toBe("Star Health · Cholecystectomy");
  });

  it("admits when it had to widen rather than implying the narrow claim", () => {
    expect(describeScope("insurer", "Star Health", "Cholecystectomy")).toBe(
      "Star Health, all procedures",
    );
  });
});

describe("riskAction", () => {
  it("names the document that's actually missing", () => {
    expect(riskAction(risk({ openGaps: ["Discharge summary"] }))).toBe(
      "Still missing: Discharge summary",
    );
  });

  it("lists several", () => {
    expect(
      riskAction(risk({ openGaps: ["Discharge summary", "Final bill"] })),
    ).toBe("Still missing: Discharge summary, Final bill");
  });

  it("doesn't imply a gap when the checklist is already complete", () => {
    expect(riskAction(risk({ openGaps: [] }))).toBe(
      "Checklist is complete — no gaps to close.",
    );
  });

  it("states the habit for reasons with nothing on the claim to point at", () => {
    expect(riskAction(risk({ reason: "documentation_delay" }))).toContain(
      "before the deadline",
    );
    expect(riskAction(risk({ reason: "incomplete_clinical_notes" }))).toContain(
      "treating doctor",
    );
  });

  it("offers nothing for a reason the desk can't act on", () => {
    expect(
      riskAction(risk({ reason: "policy_mismatch", avoidable: false })),
    ).toBeNull();
  });
});

describe("isUrgent", () => {
  it("is urgent when a frequent, preventable reason is still open on this claim", () => {
    expect(isUrgent(risk({ openGaps: ["Discharge summary"] }))).toBe(true);
  });

  it("is not urgent once the gap it warns about is closed", () => {
    expect(isUrgent(risk({ openGaps: [] }))).toBe(false);
  });

  it("is not urgent for something the desk can't prevent", () => {
    expect(
      isUrgent(
        risk({
          reason: "policy_mismatch",
          avoidable: false,
          claimsAffected: 11,
          claimsConsidered: 12,
        }),
      ),
    ).toBe(false);
  });

  it("is not urgent for a reason that's only bitten once in a while", () => {
    expect(
      isUrgent(
        risk({
          reason: "documentation_delay",
          claimsAffected: 2,
          claimsConsidered: 12,
        }),
      ),
    ).toBe(false);
  });

  it("is urgent for a frequent delay habit, which has no gap to close", () => {
    expect(
      isUrgent(
        risk({
          reason: "documentation_delay",
          claimsAffected: 6,
          claimsConsidered: 12,
        }),
      ),
    ).toBe(true);
  });
});
