import { beforeEach, describe, expect, it, vi } from "vitest";
import * as claimsRepository from "./claims.repository.js";
import * as checklistService from "../checklist/checklist.service.js";
import * as preauthLayoutsService from "../preauth-layouts/preauth-layouts.service.js";
import * as documentsRepository from "../documents/documents.repository.js";
import * as orgMembersRepository from "../members/members.repository.js";
import * as deductionsRepository from "../deductions/deductions.repository.js";
import * as enhancementsRepository from "../enhancements/enhancements.repository.js";
import * as preauthRepository from "../preauth/preauth.repository.js";
import * as insurersRepository from "../insurers/insurers.repository.js";

vi.mock("./claims.repository.js");
vi.mock("../checklist/checklist.service.js");
vi.mock("../preauth-layouts/preauth-layouts.service.js");
vi.mock("../documents/documents.repository.js");
vi.mock("../members/members.repository.js");
vi.mock("../deductions/deductions.repository.js");
vi.mock("../enhancements/enhancements.repository.js");
vi.mock("../preauth/preauth.repository.js");
vi.mock("../insurers/insurers.repository.js");
vi.mock("../audit/audit.service.js");

const MEMBER_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "33333333-3333-3333-3333-333333333333";
const CLAIM_ID = "44444444-4444-4444-4444-444444444444";

function auth(role: "desk_executive" | "desk_head") {
  return { userId: USER_ID, role };
}

describe("claims.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(orgMembersRepository.getMemberId).mockResolvedValue(MEMBER_ID);
    // Every claim freezes a layout onto itself, so the default has to
    // resolve to something — an auto-mock returning undefined would
    // have each test silently exercising a case that can't happen.
    vi.mocked(preauthLayoutsService.resolveLayout).mockResolvedValue({
      id: "layout:default",
      name: "IRDAI standard form",
      insurerId: null,
      sections: [],
    });
  });

  describe("listClaims", () => {
    it("desk_executive is forced to their own assigned claims, even if scope=all was asked for", async () => {
      vi.mocked(claimsRepository.listClaims).mockResolvedValue({
        rows: [],
        total: 0,
      });

      await import("./claims.service.js").then((m) =>
        m.listClaims(auth("desk_executive"), { scope: "all" }),
      );

      expect(claimsRepository.listClaims).toHaveBeenCalledWith(
        expect.objectContaining({ assignedTo: MEMBER_ID }),
      );
    });

    it("desk_head gets the whole org by default", async () => {
      vi.mocked(claimsRepository.listClaims).mockResolvedValue({
        rows: [],
        total: 0,
      });

      await import("./claims.service.js").then((m) =>
        m.listClaims(auth("desk_head"), { scope: "all" }),
      );

      expect(claimsRepository.listClaims).toHaveBeenCalledWith(
        expect.not.objectContaining({ assignedTo: expect.anything() }),
      );
    });
  });

  describe("getClaim", () => {
    it("desk_executive gets a not-found error for a claim assigned to someone else", async () => {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        assignedTo: "someone-else",
      } as never);

      const { getClaim, ClaimNotFoundError } =
        await import("./claims.service.js");

      await expect(getClaim(auth("desk_executive"), CLAIM_ID)).rejects.toThrow(
        ClaimNotFoundError,
      );
    });

    it("desk_executive can read a claim assigned to them", async () => {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        assignedTo: MEMBER_ID,
      } as never);

      const { getClaim } = await import("./claims.service.js");
      const claim = await getClaim(auth("desk_executive"), CLAIM_ID);
      expect(claim.id).toBe(CLAIM_ID);
    });
  });

  describe("createClaim", () => {
    it("snapshots the current checklist requirements onto the new claim", async () => {
      const INSURER_ID = "55555555-5555-5555-5555-555555555555";
      const PROCEDURE_ID = "66666666-6666-6666-6666-666666666666";
      const snapshot = [
        { documentType: "Pre-authorization form", required: true },
      ];

      vi.mocked(checklistService.getRequirementsSnapshot).mockResolvedValue(
        snapshot,
      );
      vi.mocked(claimsRepository.createClaim).mockResolvedValue({
        id: CLAIM_ID,
      } as never);

      const { createClaim } = await import("./claims.service.js");
      await createClaim(auth("desk_executive"), {
        patientName: "Rajendra Pawar",
        insurerId: INSURER_ID,
        procedureId: PROCEDURE_ID,
      });

      expect(checklistService.getRequirementsSnapshot).toHaveBeenCalledWith(
        INSURER_ID,
        PROCEDURE_ID,
      );
      expect(claimsRepository.createClaim).toHaveBeenCalledWith(
        expect.objectContaining({ patientName: "Rajendra Pawar" }),
        snapshot,
        expect.anything(),
      );
    });

    it("puts the estimate on the pre-auth form, not in the billed amount", async () => {
      // A claim being opened has billed nothing. Writing the estimate
      // to `billedAmount` made a draft report a bill it never raised,
      // and left the pre-auth form's own total blank so the desk typed
      // the same figure twice.
      vi.mocked(checklistService.getRequirementsSnapshot).mockResolvedValue([]);
      vi.mocked(claimsRepository.createClaim).mockResolvedValue({
        id: CLAIM_ID,
      } as never);

      const { createClaim } = await import("./claims.service.js");
      await createClaim(auth("desk_executive"), {
        patientName: "Priya Venkatesan",
        insurerId: "55555555-5555-5555-5555-555555555555",
        procedureId: "66666666-6666-6666-6666-666666666666",
        expectedCost: 110000,
      });

      expect(claimsRepository.createClaim).toHaveBeenCalledWith(
        expect.not.objectContaining({ expectedCost: expect.anything() }),
        [],
        expect.anything(),
      );
      // Confirmed on arrival — a human typed it (docs/adr/0005).
      expect(preauthRepository.confirm).toHaveBeenCalledWith(
        CLAIM_ID,
        "totalExpectedCost",
        "110000",
        expect.anything(),
      );
    });

    it("leaves the pre-auth total alone when no estimate was given", async () => {
      vi.mocked(checklistService.getRequirementsSnapshot).mockResolvedValue([]);
      vi.mocked(claimsRepository.createClaim).mockResolvedValue({
        id: CLAIM_ID,
      } as never);

      const { createClaim } = await import("./claims.service.js");
      await createClaim(auth("desk_executive"), {
        patientName: "Rajendra Pawar",
        insurerId: "55555555-5555-5555-5555-555555555555",
        procedureId: "66666666-6666-6666-6666-666666666666",
      });

      expect(preauthRepository.confirm).not.toHaveBeenCalled();
    });

    it("also freezes the pre-auth form layout onto the claim", async () => {
      // Same guarantee as the checklist (docs/adr/0001): an admin
      // reordering or removing a pre-auth field next month must not
      // change what this claim asked for.
      const layout = { id: "layout:default", name: "IRDAI", sections: [] };
      vi.mocked(checklistService.getRequirementsSnapshot).mockResolvedValue([]);
      vi.mocked(preauthLayoutsService.resolveLayout).mockResolvedValue(
        layout as never,
      );
      vi.mocked(claimsRepository.createClaim).mockResolvedValue({
        id: CLAIM_ID,
      } as never);

      const { createClaim } = await import("./claims.service.js");
      await createClaim(auth("desk_executive"), {
        patientName: "Rajendra Pawar",
        insurerId: "55555555-5555-5555-5555-555555555555",
        procedureId: "66666666-6666-6666-6666-666666666666",
      });

      expect(claimsRepository.createClaim).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        layout,
      );
    });
  });

  describe("getClaimGaps", () => {
    it("splits the checklist snapshot into missing vs satisfied by confirmed document slots", async () => {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        assignedTo: MEMBER_ID,
        checklistSnapshot: [
          { documentType: "Pre-authorization form", required: true },
          { documentType: "Ultrasound report (abdomen)", required: true },
          { documentType: "Previous treatment records", required: false },
        ],
      } as never);
      vi.mocked(documentsRepository.confirmedSlotsForClaim).mockResolvedValue([
        "Pre-authorization form",
      ]);

      const { getClaimGaps } = await import("./claims.service.js");
      const result = await getClaimGaps(auth("desk_executive"), CLAIM_ID);

      expect(result.missing).toEqual(["Ultrasound report (abdomen)"]);
      expect(result.satisfied).toEqual(["Pre-authorization form"]);
    });

    it("never lists an optional document as missing", async () => {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        assignedTo: MEMBER_ID,
        checklistSnapshot: [
          { documentType: "Previous treatment records", required: false },
        ],
      } as never);
      vi.mocked(documentsRepository.confirmedSlotsForClaim).mockResolvedValue(
        [],
      );

      const { getClaimGaps } = await import("./claims.service.js");
      const result = await getClaimGaps(auth("desk_executive"), CLAIM_ID);

      expect(result.missing).toEqual([]);
    });
  });

  describe("transitionClaimStatus", () => {
    it("rejects a transition the state machine doesn't allow", async () => {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        status: "DRAFT",
      } as never);

      const { transitionClaimStatus, InvalidTransitionError } =
        await import("./claims.service.js");

      await expect(
        transitionClaimStatus(
          auth("desk_head"),
          CLAIM_ID,
          "APPROVED",
          undefined,
        ),
      ).rejects.toThrow(InvalidTransitionError);
      expect(claimsRepository.recordStatusChange).not.toHaveBeenCalled();
    });

    it("rejects settling a claim when the actor isn't desk_head", async () => {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        status: "FINAL_BILL_SUBMITTED",
      } as never);

      const { transitionClaimStatus, InvalidTransitionError } =
        await import("./claims.service.js");

      await expect(
        transitionClaimStatus(
          auth("desk_executive"),
          CLAIM_ID,
          "SETTLED",
          undefined,
        ),
      ).rejects.toThrow(InvalidTransitionError);
    });

    it("allows a legal transition and records it with the resolved org-member id", async () => {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        status: "PRE_AUTH_SENT",
      } as never);
      vi.mocked(claimsRepository.recordStatusChange).mockResolvedValue({
        id: CLAIM_ID,
        status: "QUERY_RAISED",
      } as never);

      const { transitionClaimStatus } = await import("./claims.service.js");
      const result = await transitionClaimStatus(
        auth("desk_executive"),
        CLAIM_ID,
        "QUERY_RAISED",
        undefined,
      );

      expect(result.status).toBe("QUERY_RAISED");
      expect(claimsRepository.recordStatusChange).toHaveBeenCalledWith(
        CLAIM_ID,
        "QUERY_RAISED",
        MEMBER_ID,
        undefined,
      );
    });
  });
});

/**
 * The money model (docs/adr/0012). These are mostly about refusing to
 * invent a number: a shortfall against an unrecorded ceiling, or an
 * enhancement advised off a cost nobody has confirmed, are both worse
 * than an empty space on the screen.
 */
describe("claims.service.getClaimFinancials", () => {
  function claim(over: Record<string, unknown> = {}) {
    return {
      id: CLAIM_ID,
      status: "PRE_AUTH_SENT",
      sanctionedAmount: "200000.00",
      billedAmount: null,
      ...over,
    };
  }

  function preauthField(value: string | null, confirmed: boolean) {
    return [
      {
        fieldKey: "totalExpectedCost",
        value,
        confirmedAt: confirmed ? new Date() : null,
      },
    ];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(orgMembersRepository.getMemberId).mockResolvedValue(MEMBER_ID);
    vi.mocked(claimsRepository.getClaimById).mockResolvedValue(
      claim() as never,
    );
    vi.mocked(preauthRepository.listForClaim).mockResolvedValue([] as never);
    vi.mocked(deductionsRepository.totalsForClaim).mockResolvedValue({
      deducted: 0,
      recovered: 0,
    });
    vi.mocked(enhancementsRepository.getOpenForClaim).mockResolvedValue(
      undefined as never,
    );
  });

  it("raises ClaimNotFoundError for a claim outside this install", async () => {
    vi.mocked(claimsRepository.getClaimById).mockResolvedValue(
      undefined as never,
    );
    const { getClaimFinancials, ClaimNotFoundError } =
      await import("./claims.service.js");
    await expect(
      getClaimFinancials(auth("desk_head"), CLAIM_ID),
    ).rejects.toThrow(ClaimNotFoundError);
  });

  it("ignores an unconfirmed expected cost, which is only the model's opinion", async () => {
    vi.mocked(preauthRepository.listForClaim).mockResolvedValue(
      preauthField("300000", false) as never,
    );

    const { getClaimFinancials } = await import("./claims.service.js");
    const result = await getClaimFinancials(auth("desk_head"), CLAIM_ID);

    expect(result.expectedCost).toBeNull();
    // And so advises nothing, despite 300,000 against a 200,000 ceiling.
    expect(result.enhancement.advised).toBe(false);
  });

  it("uses a confirmed expected cost to advise an enhancement", async () => {
    vi.mocked(preauthRepository.listForClaim).mockResolvedValue(
      preauthField("190000", true) as never,
    );

    const { getClaimFinancials } = await import("./claims.service.js");
    const result = await getClaimFinancials(auth("desk_head"), CLAIM_ID);

    expect(result.expectedCost).toBe(190_000);
    expect(result.utilisation).toBeCloseTo(0.95);
    expect(result.enhancement.advised).toBe(true);
  });

  it("prefers the bill over the estimate once the bill has outgrown it", async () => {
    vi.mocked(claimsRepository.getClaimById).mockResolvedValue(
      claim({ billedAmount: "260000.00" }) as never,
    );
    vi.mocked(preauthRepository.listForClaim).mockResolvedValue(
      preauthField("190000", true) as never,
    );

    const { getClaimFinancials } = await import("./claims.service.js");
    const result = await getClaimFinancials(auth("desk_head"), CLAIM_ID);

    expect(result.utilisation).toBeCloseTo(1.3);
    expect(result.enhancement.reason).toContain("passed");
  });

  it("leaves the shortfall null rather than zero when no ceiling was recorded", async () => {
    vi.mocked(claimsRepository.getClaimById).mockResolvedValue(
      claim({ sanctionedAmount: null, billedAmount: "260000.00" }) as never,
    );

    const { getClaimFinancials } = await import("./claims.service.js");
    const result = await getClaimFinancials(auth("desk_head"), CLAIM_ID);

    // Zero would read as "nothing was lost"; this is "we don't know".
    expect(result.shortfall).toBeNull();
    expect(result.utilisation).toBeNull();
  });

  it("counts deductions into the shortfall and recoveries back out of it", async () => {
    vi.mocked(claimsRepository.getClaimById).mockResolvedValue(
      claim({ billedAmount: "240000.00" }) as never,
    );
    vi.mocked(deductionsRepository.totalsForClaim).mockResolvedValue({
      deducted: 30_000,
      recovered: 10_000,
    });

    const { getClaimFinancials } = await import("./claims.service.js");
    const result = await getClaimFinancials(auth("desk_head"), CLAIM_ID);

    // 240,000 billed - 200,000 sanctioned + 30,000 cut - 10,000 recovered
    expect(result.shortfall).toBe(60_000);
    expect(result.deductedAmount).toBe(30_000);
    expect(result.recoveredAmount).toBe(10_000);
  });

  it("never reports a negative shortfall on a claim that came out whole", async () => {
    vi.mocked(claimsRepository.getClaimById).mockResolvedValue(
      claim({ billedAmount: "150000.00" }) as never,
    );

    const { getClaimFinancials } = await import("./claims.service.js");
    const result = await getClaimFinancials(auth("desk_head"), CLAIM_ID);

    expect(result.shortfall).toBe(0);
  });

  it("stays quiet about enhancements while one is already with the insurer", async () => {
    vi.mocked(claimsRepository.getClaimById).mockResolvedValue(
      claim({ billedAmount: "260000.00" }) as never,
    );
    vi.mocked(enhancementsRepository.getOpenForClaim).mockResolvedValue({
      id: "open",
    } as never);

    const { getClaimFinancials } = await import("./claims.service.js");
    const result = await getClaimFinancials(auth("desk_head"), CLAIM_ID);

    expect(result.enhancement.advised).toBe(false);
    expect(result.enhancement.pending).toBe(true);
  });

  it("stops advising an enhancement once the claim is settled", async () => {
    vi.mocked(claimsRepository.getClaimById).mockResolvedValue(
      claim({ status: "SETTLED", billedAmount: "260000.00" }) as never,
    );

    const { getClaimFinancials } = await import("./claims.service.js");
    const result = await getClaimFinancials(auth("desk_head"), CLAIM_ID);

    expect(result.enhancement.advised).toBe(false);
    // The shortfall still stands — that's the part worth knowing after.
    expect(result.shortfall).toBe(60_000);
  });

  /**
   * The case docs/adr/0001's forward-only rule leaves stranded: a claim
   * opened against a pair with no rules is snapshotted empty and then
   * reports nothing missing for the rest of its life.
   */
  describe("applyCurrentRules", () => {
    beforeEach(() => {
      vi.mocked(orgMembersRepository.getMemberId).mockResolvedValue(MEMBER_ID);
    });

    it("gives an empty claim the pair's rules, keeping each one's required flag", async () => {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        insurerId: "i1",
        procedureId: "p1",
        checklistSnapshot: [],
      } as never);
      vi.mocked(checklistService.getRequirementsSnapshot).mockResolvedValue([
        { documentType: "Pre-authorization form", required: true },
        { documentType: "Previous treatment records", required: false },
      ] as never);
      vi.mocked(claimsRepository.addChecklistSlot).mockResolvedValue({
        id: CLAIM_ID,
      } as never);

      const { applyCurrentRules } = await import("./claims.service.js");
      await applyCurrentRules(auth("desk_head"), CLAIM_ID);

      // Required must survive: an optional-only checklist would still
      // report nothing missing, which is the bug being fixed.
      expect(claimsRepository.addChecklistSlot).toHaveBeenCalledWith(
        CLAIM_ID,
        expect.objectContaining({
          documentType: "Pre-authorization form",
          required: true,
          fromRules: true,
        }),
      );
      expect(claimsRepository.addChecklistSlot).toHaveBeenCalledWith(
        CLAIM_ID,
        expect.objectContaining({
          documentType: "Previous treatment records",
          required: false,
        }),
      );
    });

    it("refuses a claim that already has a checklist", async () => {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        insurerId: "i1",
        procedureId: "p1",
        checklistSnapshot: [{ documentType: "Photo ID proof", required: true }],
      } as never);

      const { applyCurrentRules, ChecklistAlreadySetError } =
        await import("./claims.service.js");

      // This is what keeps the feature from being a hole in the
      // forward-only guarantee: it fills an absence, it never
      // re-snapshots requirements someone already decided.
      await expect(
        applyCurrentRules(auth("desk_head"), CLAIM_ID),
      ).rejects.toThrow(ChecklistAlreadySetError);
      expect(claimsRepository.addChecklistSlot).not.toHaveBeenCalled();
    });

    it("says so when the pair still has no rules, rather than silently doing nothing", async () => {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        insurerId: "i1",
        procedureId: "p1",
        checklistSnapshot: [],
      } as never);
      vi.mocked(checklistService.getRequirementsSnapshot).mockResolvedValue(
        [] as never,
      );

      const { applyCurrentRules, NoRulesToApplyError } =
        await import("./claims.service.js");

      await expect(
        applyCurrentRules(auth("desk_head"), CLAIM_ID),
      ).rejects.toThrow(NoRulesToApplyError);
    });
  });

  /**
   * The counterpart addChecklistSlot never had: a wrong slot used to be
   * stuck on a claim for its whole life.
   */
  describe("removeChecklistSlot", () => {
    beforeEach(() => {
      vi.mocked(orgMembersRepository.getMemberId).mockResolvedValue(MEMBER_ID);
      vi.mocked(documentsRepository.confirmedSlotsForClaim).mockResolvedValue(
        [],
      );
      vi.mocked(claimsRepository.removeChecklistSlot).mockResolvedValue({
        id: CLAIM_ID,
      } as never);
    });

    function claimWith(snapshot: unknown[]) {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        checklistSnapshot: snapshot,
      } as never);
    }

    it("removes a slot a person added", async () => {
      claimWith([
        {
          documentType: "Cost estimate",
          required: false,
          addedAt: "2026-11-05",
        },
      ]);

      const { removeChecklistSlot } = await import("./claims.service.js");
      await removeChecklistSlot(auth("desk_head"), CLAIM_ID, "Cost estimate");

      expect(claimsRepository.removeChecklistSlot).toHaveBeenCalledWith(
        CLAIM_ID,
        "Cost estimate",
      );
    });

    it("refuses a requirement restored from the rules, not just an original one", async () => {
      // applyCurrentRules adds slots through this same path, so without
      // the marker every restored requirement would be deletable — and
      // restoring a checklist would quietly undo its own point.
      claimWith([
        {
          documentType: "Photo ID proof",
          required: true,
          addedAt: "2026-11-05",
          fromRules: true,
        },
      ]);

      const { removeChecklistSlot, OriginalSlotError } =
        await import("./claims.service.js");

      await expect(
        removeChecklistSlot(auth("desk_head"), CLAIM_ID, "Photo ID proof"),
      ).rejects.toThrow(OriginalSlotError);
      expect(claimsRepository.removeChecklistSlot).not.toHaveBeenCalled();
    });

    it("refuses a slot that came from the rules the claim was opened against", async () => {
      claimWith([{ documentType: "Photo ID proof", required: true }]);

      const { removeChecklistSlot, OriginalSlotError } =
        await import("./claims.service.js");

      // The gap view is the safety net; "delete the requirement you
      // can't satisfy" is the one edit that would make it a formality.
      await expect(
        removeChecklistSlot(auth("desk_head"), CLAIM_ID, "Photo ID proof"),
      ).rejects.toThrow(OriginalSlotError);
      expect(claimsRepository.removeChecklistSlot).not.toHaveBeenCalled();
    });

    it("refuses a slot with a document filed in it", async () => {
      claimWith([
        {
          documentType: "Cost estimate",
          required: false,
          addedAt: "2026-11-05",
        },
      ]);
      vi.mocked(documentsRepository.confirmedSlotsForClaim).mockResolvedValue([
        "Cost estimate",
      ]);

      const { removeChecklistSlot, SlotInUseError } =
        await import("./claims.service.js");

      // Otherwise the document stays on the claim counting toward
      // nothing — the same invisible state filing into a missing slot
      // would create.
      await expect(
        removeChecklistSlot(auth("desk_head"), CLAIM_ID, "Cost estimate"),
      ).rejects.toThrow(SlotInUseError);
      expect(claimsRepository.removeChecklistSlot).not.toHaveBeenCalled();
    });

    it("says so when the slot isn't there at all", async () => {
      claimWith([]);

      const { removeChecklistSlot, SlotNotOnClaimError } =
        await import("./claims.service.js");

      await expect(
        removeChecklistSlot(auth("desk_head"), CLAIM_ID, "Nothing"),
      ).rejects.toThrow(SlotNotOnClaimError);
    });
  });
});

/**
 * Government scheme claims.
 *
 * PM-JAY and the state schemes pay a package rate, fixed by the code
 * the desk picks, not an estimate anyone negotiates. That inverts the
 * private model this product was built around — and the inversion is
 * the only part that genuinely differs, because a scheme lives on the
 * existing payer master and inherits its checklist rules and form
 * layout like any insurer.
 */
describe("createClaim · government schemes", () => {
  const BASE = {
    patientName: "Rajendra Pawar",
    insurerId: "11111111-1111-1111-1111-111111111111",
    procedureId: "22222222-2222-2222-2222-222222222222",
  };

  function payer(type: string) {
    vi.mocked(insurersRepository.getById).mockResolvedValue({
      id: BASE.insurerId,
      name: type === "scheme" ? "PM-JAY" : "Company B",
      type,
    } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(claimsRepository.createClaim).mockResolvedValue({
      id: "claim-1",
      patientName: BASE.patientName,
      status: "DRAFT",
    } as never);
  });

  it("writes the package rate as the sanctioned amount", async () => {
    payer("scheme");

    const { createClaim } = await import("./claims.service.js");
    await createClaim(auth("desk_head"), {
      ...BASE,
      packageCode: "HBP-SG-012",
      packageRate: 28_500,
    } as never);

    // A scheme answers before it is asked. Leaving this null would
    // show "Sanctioned: —" on a claim whose worth was never in doubt.
    expect(claimsRepository.createClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        packageCode: "HBP-SG-012",
        packageRate: 28_500,
        sanctionedAmount: 28_500,
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("refuses a package on a claim that isn't against a scheme", async () => {
    payer("insurer");

    const { createClaim, PackageOnNonSchemeClaimError } =
      await import("./claims.service.js");

    // Accepting it would put a number in `sanctionedAmount` that no
    // insurer ever sanctioned — the field docs/adr/0012's whole
    // shortfall model is measured against.
    await expect(
      createClaim(auth("desk_head"), {
        ...BASE,
        packageCode: "HBP-SG-012",
        packageRate: 28_500,
      } as never),
    ).rejects.toThrow(PackageOnNonSchemeClaimError);
    expect(claimsRepository.createClaim).not.toHaveBeenCalled();
  });

  it("leaves a private claim's sanctioned amount alone", async () => {
    payer("insurer");

    const { createClaim } = await import("./claims.service.js");
    await createClaim(auth("desk_head"), {
      ...BASE,
      billedAmount: 185_000,
    } as never);

    // Nothing has been sanctioned yet; the insurer has not answered.
    expect(claimsRepository.createClaim).toHaveBeenCalledWith(
      expect.not.objectContaining({ sanctionedAmount: expect.anything() }),
      expect.anything(),
      expect.anything(),
    );
  });

  /*
    `claims.assigned_to` decided what a desk executive could see from the
    first release and nothing could write it, so the role saw an empty
    desk with no way to be given work. These cover the write half.
  */
  describe("assignClaim", () => {
    const ASSIGNEE = "55555555-5555-5555-5555-555555555555";

    function claimAssignedTo(assignedTo: string | null) {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue({
        id: CLAIM_ID,
        assignedTo,
      } as never);
    }

    it("points the claim at a member of the desk", async () => {
      claimAssignedTo(null);
      vi.mocked(orgMembersRepository.getMemberById).mockResolvedValue({
        id: ASSIGNEE,
      } as never);
      vi.mocked(claimsRepository.assign).mockResolvedValue({
        id: CLAIM_ID,
        assignedTo: ASSIGNEE,
      } as never);

      const service = await import("./claims.service.js");
      await service.assignClaim(auth("desk_head"), CLAIM_ID, ASSIGNEE);

      expect(claimsRepository.assign).toHaveBeenCalledWith(CLAIM_ID, ASSIGNEE);
    });

    it("hands a claim back to the unassigned pool", async () => {
      claimAssignedTo(ASSIGNEE);
      vi.mocked(claimsRepository.assign).mockResolvedValue({
        id: CLAIM_ID,
        assignedTo: null,
      } as never);

      const service = await import("./claims.service.js");
      await service.assignClaim(auth("desk_head"), CLAIM_ID, null);

      // Null is a real move, not "leave it alone" — so it reaches the
      // repository rather than being treated as an absent field.
      expect(claimsRepository.assign).toHaveBeenCalledWith(CLAIM_ID, null);
      // And it never looks up a member that was never named.
      expect(orgMembersRepository.getMemberById).not.toHaveBeenCalled();
    });

    it("refuses an assignee who is not on the desk", async () => {
      claimAssignedTo(null);
      vi.mocked(orgMembersRepository.getMemberById).mockResolvedValue(
        undefined as never,
      );

      const service = await import("./claims.service.js");
      await expect(
        service.assignClaim(auth("desk_head"), CLAIM_ID, ASSIGNEE),
      ).rejects.toBeInstanceOf(service.AssigneeNotFoundError);
      expect(claimsRepository.assign).not.toHaveBeenCalled();
    });

    it("refuses a claim that does not exist, before looking up the member", async () => {
      vi.mocked(claimsRepository.getClaimById).mockResolvedValue(
        undefined as never,
      );

      const service = await import("./claims.service.js");
      await expect(
        service.assignClaim(auth("desk_head"), CLAIM_ID, ASSIGNEE),
      ).rejects.toBeInstanceOf(service.ClaimNotFoundError);
      expect(orgMembersRepository.getMemberById).not.toHaveBeenCalled();
    });
  });
});
