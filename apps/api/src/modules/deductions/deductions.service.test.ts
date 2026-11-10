import { beforeEach, describe, expect, it, vi } from "vitest";
import * as repo from "./deductions.repository.js";
import * as claimsRepository from "../claims/claims.repository.js";
import * as claimsService from "../claims/claims.service.js";

vi.mock("./deductions.repository.js");
vi.mock("../claims/claims.repository.js");
vi.mock("../claims/claims.service.js");
vi.mock("../members/members.repository.js");
vi.mock("../audit/audit.service.js");

const USER_ID = "22222222-2222-2222-2222-222222222222";
const CLAIM_ID = "33333333-3333-3333-3333-333333333333";
const INSURER_ID = "66666666-6666-6666-6666-666666666666";
const PROCEDURE_ID = "77777777-7777-7777-7777-777777777777";

const auth = { userId: USER_ID, role: "desk_head" as const };

/** `recovered` defaults to nothing clawed back, which is the common case. */
function history(
  claimsConsidered: number,
  byReason: {
    reason: string;
    claimsAffected: number;
    total: number;
    recovered?: number;
  }[] = [],
) {
  return {
    claimsConsidered,
    byReason: byReason.map((r) => ({ recovered: 0, ...r })),
  };
}

/**
 * The feature's whole value is that a desk exec believes it, so these
 * are mostly about the cases where the honest output is to say less:
 * too little history, a denominator that would flatter us, a reason
 * nobody can act on heading the list.
 */
describe("deductions.service.assessRisk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
      id: CLAIM_ID,
      insurerId: INSURER_ID,
      procedureId: PROCEDURE_ID,
    } as never);
    vi.mocked(claimsService.getClaimGaps).mockResolvedValue({
      missing: [],
      satisfied: [],
    });
  });

  it("raises ClaimNotFoundError for a claim outside the org", async () => {
    vi.mocked(claimsRepository.getClaimById).mockResolvedValue(
      undefined as never,
    );

    const { assessRisk, ClaimNotFoundError } =
      await import("./deductions.service.js");
    await expect(assessRisk(auth, CLAIM_ID)).rejects.toThrow(
      ClaimNotFoundError,
    );
  });

  it("says nothing at all below the minimum history, rather than a rate off two claims", async () => {
    vi.mocked(repo.settledHistoryForScope).mockResolvedValue(
      history(2, [
        { reason: "missing_document", claimsAffected: 2, total: 80_000 },
      ]),
    );

    const { assessRisk } = await import("./deductions.service.js");
    const result = await assessRisk(auth, CLAIM_ID);

    expect(result.enoughHistory).toBe(false);
    expect(result.risks).toEqual([]);
    expect(result.claimsConsidered).toBe(2);
    // Nothing to cross-reference, so the gap lookup is never paid for.
    expect(claimsService.getClaimGaps).not.toHaveBeenCalled();
  });

  it("widens to insurer-only history when this procedure is too thin", async () => {
    vi.mocked(repo.settledHistoryForScope)
      .mockResolvedValueOnce(history(2))
      .mockResolvedValueOnce(
        history(20, [
          { reason: "documentation_delay", claimsAffected: 5, total: 150_000 },
        ]),
      );

    const { assessRisk } = await import("./deductions.service.js");
    const result = await assessRisk(auth, CLAIM_ID);

    expect(result.scope).toBe("insurer");
    expect(result.claimsConsidered).toBe(20);
    expect(result.risks[0]).toMatchObject({
      reason: "documentation_delay",
      claimsAffected: 5,
      claimsConsidered: 20,
    });
    // The narrow query ran first and asked about the procedure; the
    // fallback deliberately didn't.
    const [narrow, wide] = vi.mocked(repo.settledHistoryForScope).mock.calls;
    expect(narrow![0].procedureId).toBe(PROCEDURE_ID);
    expect(wide![0].procedureId).toBeUndefined();
  });

  it("keeps the narrow scope once this procedure has enough of its own history", async () => {
    vi.mocked(repo.settledHistoryForScope).mockResolvedValue(
      history(12, [
        { reason: "missing_document", claimsAffected: 7, total: 210_000 },
      ]),
    );

    const { assessRisk } = await import("./deductions.service.js");
    const result = await assessRisk(auth, CLAIM_ID);

    expect(result.scope).toBe("insurer_procedure");
    expect(repo.settledHistoryForScope).toHaveBeenCalledTimes(1);
  });

  it("stays on the narrow scope when widening wouldn't add any claims", async () => {
    // Every settled claim with this insurer is for this procedure, so
    // the wider query returns the same count. Reporting the wider scope
    // would tell the desk something less specific for no extra evidence.
    vi.mocked(repo.settledHistoryForScope)
      .mockResolvedValueOnce(
        history(4, [
          { reason: "missing_document", claimsAffected: 3, total: 90_000 },
        ]),
      )
      .mockResolvedValueOnce(
        history(4, [
          { reason: "missing_document", claimsAffected: 3, total: 90_000 },
        ]),
      );

    const { assessRisk } = await import("./deductions.service.js");
    const result = await assessRisk(auth, CLAIM_ID);

    expect(result.scope).toBe("insurer_procedure");
    expect(result.claimsConsidered).toBe(4);
  });

  it("reports the rate, the money and the average a recurrence costs", async () => {
    vi.mocked(repo.settledHistoryForScope).mockResolvedValue(
      history(12, [
        { reason: "missing_document", claimsAffected: 6, total: 240_000 },
      ]),
    );

    const { assessRisk } = await import("./deductions.service.js");
    const [risk] = (await assessRisk(auth, CLAIM_ID)).risks;

    expect(risk).toMatchObject({
      claimsAffected: 6,
      claimsConsidered: 12,
      historicalTotal: 240_000,
      averagePerClaim: 40_000,
      // half the claims × ₹40k each
      expectedCost: 20_000,
      avoidable: true,
    });
  });

  it("puts a preventable reason above a more expensive one nobody can act on", async () => {
    vi.mocked(repo.settledHistoryForScope).mockResolvedValue(
      history(10, [
        // Costs more, but policy terms aren't the desk's to fix.
        { reason: "policy_mismatch", claimsAffected: 9, total: 900_000 },
        {
          reason: "incomplete_clinical_notes",
          claimsAffected: 3,
          total: 60_000,
        },
      ]),
    );

    const { assessRisk } = await import("./deductions.service.js");
    const { risks } = await assessRisk(auth, CLAIM_ID);

    expect(risks.map((r) => r.reason)).toEqual([
      "incomplete_clinical_notes",
      "policy_mismatch",
    ]);
    expect(risks[1]!.avoidable).toBe(false);
  });

  it("orders two preventable reasons by what they're expected to cost", async () => {
    vi.mocked(repo.settledHistoryForScope).mockResolvedValue(
      history(10, [
        // Rare but ruinous beats frequent but cheap.
        { reason: "documentation_delay", claimsAffected: 8, total: 80_000 },
        { reason: "missing_document", claimsAffected: 2, total: 400_000 },
      ]),
    );

    const { assessRisk } = await import("./deductions.service.js");
    const { risks } = await assessRisk(auth, CLAIM_ID);

    expect(risks.map((r) => r.reason)).toEqual([
      "missing_document",
      "documentation_delay",
    ]);
  });

  it("names the documents missing right now on a missing-document warning", async () => {
    vi.mocked(repo.settledHistoryForScope).mockResolvedValue(
      history(12, [
        { reason: "missing_document", claimsAffected: 7, total: 210_000 },
        { reason: "documentation_delay", claimsAffected: 4, total: 40_000 },
      ]),
    );
    vi.mocked(claimsService.getClaimGaps).mockResolvedValue({
      missing: ["Discharge summary", "Final itemised bill"],
      satisfied: ["Pre-authorization form"],
    });

    const { assessRisk } = await import("./deductions.service.js");
    const { risks } = await assessRisk(auth, CLAIM_ID);

    expect(risks[0]).toMatchObject({
      reason: "missing_document",
      openGaps: ["Discharge summary", "Final itemised bill"],
    });
    // Nothing on the claim corresponds to a delay, so it claims nothing.
    expect(risks[1]!.openGaps).toEqual([]);
  });

  it("buckets a reason the enum no longer recognises instead of crashing the claim file", async () => {
    vi.mocked(repo.settledHistoryForScope).mockResolvedValue(
      history(10, [
        { reason: "room_rent_capping", claimsAffected: 4, total: 100_000 },
      ]),
    );

    const { assessRisk } = await import("./deductions.service.js");
    const { risks } = await assessRisk(auth, CLAIM_ID);

    expect(risks[0]).toMatchObject({ reason: "other", avoidable: false });
  });
});

/**
 * Appeals (docs/adr/0013). The rules worth pinning are the ones that
 * stop the recovery number being fiction: an outcome derived from the
 * money rather than chosen, a recovery that can't exceed what was cut,
 * and no second decision on a settled appeal.
 */
describe("deductions.service appeals", () => {
  const DEDUCTION_ID = "99999999-9999-9999-9999-999999999999";

  function deduction(over: Record<string, unknown> = {}) {
    return {
      id: DEDUCTION_ID,
      claimId: CLAIM_ID,
      amount: "50000.00",
      reason: "missing_document",
      appealStatus: "NOT_CONTESTED",
      ...over,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repo.getById).mockResolvedValue(deduction() as never);
    vi.mocked(repo.contest).mockResolvedValue(
      deduction({ appealStatus: "CONTESTED" }) as never,
    );
    vi.mocked(repo.resolveAppeal).mockResolvedValue(deduction() as never);
  });

  it("opens an appeal on an uncontested deduction", async () => {
    const { contestDeduction } = await import("./deductions.service.js");
    const result = await contestDeduction(auth, DEDUCTION_ID, {
      note: "Discharge summary was sent on the 3rd — attaching proof",
    });

    expect(repo.contest).toHaveBeenCalledWith(
      DEDUCTION_ID,
      "Discharge summary was sent on the 3rd — attaching proof",
    );
    expect(result.appealStatus).toBe("CONTESTED");
  });

  it("won't open a second appeal on the same deduction", async () => {
    vi.mocked(repo.getById).mockResolvedValue(
      deduction({ appealStatus: "CONTESTED" }) as never,
    );

    const { contestDeduction, AppealAlreadyOpenError } =
      await import("./deductions.service.js");
    await expect(contestDeduction(auth, DEDUCTION_ID, {})).rejects.toThrow(
      AppealAlreadyOpenError,
    );
    expect(repo.contest).not.toHaveBeenCalled();
  });

  it("derives a full recovery from the amount, not from a dropdown", async () => {
    vi.mocked(repo.getById).mockResolvedValue(
      deduction({ appealStatus: "CONTESTED" }) as never,
    );

    const { resolveAppeal } = await import("./deductions.service.js");
    await resolveAppeal(auth, DEDUCTION_ID, { recoveredAmount: 50_000 });

    expect(repo.resolveAppeal).toHaveBeenCalledWith(
      DEDUCTION_ID,
      "RECOVERED",
      50_000,
      undefined,
    );
  });

  it("derives a partial recovery", async () => {
    vi.mocked(repo.getById).mockResolvedValue(
      deduction({ appealStatus: "CONTESTED" }) as never,
    );

    const { resolveAppeal } = await import("./deductions.service.js");
    await resolveAppeal(auth, DEDUCTION_ID, { recoveredAmount: 20_000 });

    expect(repo.resolveAppeal).toHaveBeenCalledWith(
      DEDUCTION_ID,
      "PARTIALLY_RECOVERED",
      20_000,
      undefined,
    );
  });

  it("records a lost appeal as upheld, which is a real and useful answer", async () => {
    vi.mocked(repo.getById).mockResolvedValue(
      deduction({ appealStatus: "CONTESTED" }) as never,
    );

    const { resolveAppeal } = await import("./deductions.service.js");
    await resolveAppeal(auth, DEDUCTION_ID, { recoveredAmount: 0 });

    expect(repo.resolveAppeal).toHaveBeenCalledWith(
      DEDUCTION_ID,
      "UPHELD",
      0,
      undefined,
    );
  });

  it("refuses a recovery larger than the deduction, which is a typo", async () => {
    vi.mocked(repo.getById).mockResolvedValue(
      deduction({ appealStatus: "CONTESTED" }) as never,
    );

    const { resolveAppeal, RecoveryExceedsDeductionError } =
      await import("./deductions.service.js");
    await expect(
      resolveAppeal(auth, DEDUCTION_ID, { recoveredAmount: 60_000 }),
    ).rejects.toThrow(RecoveryExceedsDeductionError);
    expect(repo.resolveAppeal).not.toHaveBeenCalled();
  });

  it("won't resolve an appeal that already has an outcome", async () => {
    vi.mocked(repo.getById).mockResolvedValue(
      deduction({ appealStatus: "UPHELD" }) as never,
    );

    const { resolveAppeal, AppealAlreadyResolvedError } =
      await import("./deductions.service.js");
    await expect(
      resolveAppeal(auth, DEDUCTION_ID, { recoveredAmount: 10_000 }),
    ).rejects.toThrow(AppealAlreadyResolvedError);
  });

  it("can resolve an appeal nobody formally opened", async () => {
    // The insurer sometimes just pays. Forcing a CONTESTED step first
    // would mean inventing a date nobody recorded.
    const { resolveAppeal } = await import("./deductions.service.js");
    await resolveAppeal(auth, DEDUCTION_ID, { recoveredAmount: 50_000 });
    expect(repo.resolveAppeal).toHaveBeenCalled();
  });

  it("raises DeductionNotFoundError for an unknown id", async () => {
    vi.mocked(repo.getById).mockResolvedValue(undefined as never);

    const { resolveAppeal, DeductionNotFoundError } =
      await import("./deductions.service.js");
    await expect(
      resolveAppeal(auth, DEDUCTION_ID, { recoveredAmount: 1 }),
    ).rejects.toThrow(DeductionNotFoundError);
  });
});

describe("deductions.service.assessRisk with recoveries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
      id: CLAIM_ID,
      insurerId: INSURER_ID,
      procedureId: PROCEDURE_ID,
    } as never);
    vi.mocked(claimsService.getClaimGaps).mockResolvedValue({
      missing: [],
      satisfied: [],
    });
  });

  it("ranks on what a reason actually cost, after appeals", async () => {
    vi.mocked(repo.settledHistoryForScope).mockResolvedValue(
      history(10, [
        // Cut more, but the hospital wins almost all of it back.
        {
          reason: "missing_document",
          claimsAffected: 5,
          total: 500_000,
          recovered: 460_000,
        },
        {
          reason: "documentation_delay",
          claimsAffected: 5,
          total: 200_000,
          recovered: 0,
        },
      ]),
    );

    const { assessRisk } = await import("./deductions.service.js");
    const { risks } = await assessRisk(auth, CLAIM_ID);

    expect(risks.map((r) => r.reason)).toEqual([
      "documentation_delay",
      "missing_document",
    ]);
    expect(risks[1]).toMatchObject({
      historicalTotal: 500_000,
      recoveredTotal: 460_000,
      netTotal: 40_000,
      averagePerClaim: 8_000,
    });
  });

  it("never reports a negative net, however the numbers were entered", async () => {
    vi.mocked(repo.settledHistoryForScope).mockResolvedValue(
      history(10, [
        {
          reason: "missing_document",
          claimsAffected: 2,
          total: 50_000,
          recovered: 80_000,
        },
      ]),
    );

    const { assessRisk } = await import("./deductions.service.js");
    const { risks } = await assessRisk(auth, CLAIM_ID);
    expect(risks[0]!.netTotal).toBe(0);
  });
});

/*
  A deduction is money cut from this bill, and the amount was only ever
  checked in the abstract -- a positive number under a hundred million.
  Nothing tied it to the claim, so a stray zero on a ninety-thousand
  rupee bill went in at nine hundred thousand, and the recovery rate,
  the ageing report and the avoidable-deduction target were all wrong
  from that keystroke until `db:verify` happened to run.
*/
describe("deductions.service.recordDeduction", () => {
  const deduction = { reason: "missing_document" as const, amount: 10_000 };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repo.create).mockResolvedValue({ id: "d1" } as never);
    vi.mocked(repo.totalsForClaim).mockResolvedValue({
      deducted: 0,
      recovered: 0,
    } as never);
  });

  function billed(billedAmount: string | null) {
    vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
      id: CLAIM_ID,
      billedAmount,
    } as never);
  }

  it("refuses a single deduction larger than the bill", async () => {
    billed("90000.00");
    const service = await import("./deductions.service.js");
    await expect(
      service.recordDeduction(auth, CLAIM_ID, {
        ...deduction,
        amount: 900_000,
      } as never),
    ).rejects.toBeInstanceOf(service.DeductionsExceedBillError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("counts what is already deducted, not just this one", async () => {
    // Each cut is plausible on its own; it is the running total that
    // overdraws the bill, which is how this goes wrong in practice --
    // four reasons recorded one at a time.
    billed("90000.00");
    vi.mocked(repo.totalsForClaim).mockResolvedValue({
      deducted: 85_000,
      recovered: 0,
    } as never);

    const service = await import("./deductions.service.js");
    await expect(
      service.recordDeduction(auth, CLAIM_ID, deduction as never),
    ).rejects.toBeInstanceOf(service.DeductionsExceedBillError);
  });

  it("allows cuts that come to exactly the bill", async () => {
    // A fully disallowed claim is a real outcome, not an error.
    billed("90000.00");
    vi.mocked(repo.totalsForClaim).mockResolvedValue({
      deducted: 80_000,
      recovered: 0,
    } as never);

    const service = await import("./deductions.service.js");
    await service.recordDeduction(auth, CLAIM_ID, deduction as never);
    expect(repo.create).toHaveBeenCalled();
  });

  it("doesn't check against a bill that hasn't been raised", async () => {
    billed(null);
    const service = await import("./deductions.service.js");
    await service.recordDeduction(auth, CLAIM_ID, {
      ...deduction,
      amount: 500_000,
    } as never);
    expect(repo.create).toHaveBeenCalled();
  });
});
