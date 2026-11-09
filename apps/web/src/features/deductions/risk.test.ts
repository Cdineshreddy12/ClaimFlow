import { describe, expect, it } from "vitest";
import type { DeductionRisk } from "@claimflow/contracts";
import {
  describeScope,
  formatCost,
  formatHeadline,
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

/*
  The row that prompted this read "₹3,500 lost · ₹0 each time": the
  gross against the net, with the appeal that reconciles them nowhere in
  sight. Both numbers were right and the row was unreadable.
*/
describe("a deduction the desk won back", () => {
  const appealed = risk({
    reason: "policy_mismatch",
    avoidable: false,
    claimsAffected: 1,
    claimsConsidered: 5,
    historicalTotal: 3_500,
    recoveredTotal: 3_500,
    netTotal: 0,
    averagePerClaim: 0,
    expectedCost: 0,
  });

  it("says the money came back instead of printing ₹0 each time", () => {
    expect(formatCost(appealed)).toBe("₹3,500 cut, all recovered on appeal");
  });

  it("does not call it lost, and does not head the row in alarm red", () => {
    expect(formatHeadline(appealed)).toEqual({
      text: "₹3,500 recovered",
      lost: false,
    });
  });

  it("names the recovery on a partial win and still counts the rest lost", () => {
    const partial = risk({
      historicalTotal: 8_000,
      recoveredTotal: 3_000,
      netTotal: 5_000,
      averagePerClaim: 5_000,
    });
    expect(formatCost(partial)).toBe(
      "₹5,000 each time, after ₹3,000 recovered on appeal",
    );
    expect(formatHeadline(partial)).toEqual({
      text: "₹5,000 lost",
      lost: true,
    });
  });

  it("leaves a deduction nobody appealed exactly as it was", () => {
    expect(formatCost(risk())).toBe("₹30,000 each time");
    expect(formatHeadline(risk())).toEqual({
      text: "₹2,10,000 lost",
      lost: true,
    });
  });

  it("rounds the average rather than showing paise", () => {
    expect(formatCost(risk({ averagePerClaim: 1_233.33 }))).toBe(
      "₹1,233 each time",
    );
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
    ).toBe("Star Health claims for Cholecystectomy");
  });

  it("admits when it had to widen rather than implying the narrow claim", () => {
    expect(describeScope("insurer", "Star Health", "Cholecystectomy")).toBe(
      "Star Health claims for any procedure",
    );
  });

  /*
    The card drops this into "Across 5 settled …, about ₹1,900 of
    preventable deductions per claim", so it has to survive being read
    as part of that sentence. It did not: a bare "Star Health, all
    procedures" put the comma inside the noun phrase and produced
    "5 settled Star Health, all procedures claims".
  */
  it("reads as English inside the sentence the card builds", () => {
    const sentence = (scope: "insurer" | "insurer_procedure") =>
      `Across 5 settled ${describeScope(scope, "Star Health", "Cholecystectomy")}, about ₹1,900 of preventable deductions per claim.`;

    expect(sentence("insurer_procedure")).toBe(
      "Across 5 settled Star Health claims for Cholecystectomy, about ₹1,900 of preventable deductions per claim.",
    );
    expect(sentence("insurer")).toBe(
      "Across 5 settled Star Health claims for any procedure, about ₹1,900 of preventable deductions per claim.",
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
