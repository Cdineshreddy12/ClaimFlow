import { beforeEach, describe, expect, it, vi } from "vitest";
import * as checklistRepository from "./checklist.repository.js";

vi.mock("./checklist.repository.js");
vi.mock("../audit/audit.service.js");
vi.mock("../members/members.repository.js");

const USER_ID = "22222222-2222-2222-2222-222222222222";
const INSURER_ID = "22222222-2222-2222-2222-222222222222";
const PROCEDURE_ID = "33333333-3333-3333-3333-333333333333";

describe("checklist.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createRule", () => {
    it("turns a unique-constraint violation into a clean DuplicateRuleError", async () => {
      vi.mocked(checklistRepository.createRule).mockRejectedValue(
        Object.assign(
          new Error("duplicate key value violates unique constraint"),
          { code: "23505" },
        ),
      );

      const { createRule, DuplicateRuleError } =
        await import("./checklist.service.js");

      await expect(
        createRule(
          { userId: USER_ID },
          {
            insurerId: INSURER_ID,
            procedureId: PROCEDURE_ID,
            documentType: "Pre-auth form",
            required: true,
          },
        ),
      ).rejects.toThrow(DuplicateRuleError);
    });

    it("lets any other database error through unchanged", async () => {
      vi.mocked(checklistRepository.createRule).mockRejectedValue(
        new Error("connection reset"),
      );

      const { createRule } = await import("./checklist.service.js");

      await expect(
        createRule(
          { userId: USER_ID },
          {
            insurerId: INSURER_ID,
            procedureId: PROCEDURE_ID,
            documentType: "Pre-auth form",
            required: true,
          },
        ),
      ).rejects.toThrow("connection reset");
    });
  });

  describe("updateRule / deleteRule", () => {
    it("raises RuleNotFoundError when the update affects no row", async () => {
      vi.mocked(checklistRepository.updateRule).mockResolvedValue(undefined);

      const { updateRule, RuleNotFoundError } =
        await import("./checklist.service.js");

      await expect(
        updateRule({ userId: USER_ID }, "missing-id", {
          required: false,
        }),
      ).rejects.toThrow(RuleNotFoundError);
    });

    it("raises RuleNotFoundError when the delete affects no row", async () => {
      vi.mocked(checklistRepository.deleteRule).mockResolvedValue(undefined);

      const { deleteRule, RuleNotFoundError } =
        await import("./checklist.service.js");

      await expect(
        deleteRule({ userId: USER_ID }, "missing-id"),
      ).rejects.toThrow(RuleNotFoundError);
    });
  });

  describe("getRequirementsSnapshot", () => {
    it("reduces rules down to the documentType/required shape stored on a claim", async () => {
      vi.mocked(checklistRepository.listRules).mockResolvedValue([
        {
          id: "r1",
          insurerId: INSURER_ID,
          procedureId: PROCEDURE_ID,
          documentType: "Pre-auth form",
          required: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "r2",
          insurerId: INSURER_ID,
          procedureId: PROCEDURE_ID,
          documentType: "Previous records",
          required: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const { getRequirementsSnapshot } =
        await import("./checklist.service.js");
      const snapshot = await getRequirementsSnapshot(INSURER_ID, PROCEDURE_ID);

      expect(snapshot).toEqual([
        { documentType: "Pre-auth form", required: true },
        { documentType: "Previous records", required: false },
      ]);
    });
  });
});

/**
 * Proposals from TPA queries (docs/adr/0016). The tests that matter are
 * the ones that stop a bad proposal reaching a desk head: a duplicate
 * of a rule that already exists, a rate above 100% from two spellings
 * of one item, or a pattern drawn from a single email.
 */
describe("checklist.service.proposeRules", () => {
  const auth = { userId: USER_ID };

  function requested(over: Record<string, unknown> = {}) {
    return {
      insurerId: INSURER_ID,
      insurerName: "Star Health",
      procedureId: PROCEDURE_ID,
      procedureName: "Cholecystectomy",
      requestedItem: "Discharge summary",
      claimsRequested: 9,
      claimsSubmitted: 14,
      ...over,
    };
  }

  function rule(over: Record<string, unknown> = {}) {
    return {
      id: "rule-1",
      insurerId: INSURER_ID,
      procedureId: PROCEDURE_ID,
      documentType: "Discharge summary",
      required: true,
      ...over,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checklistRepository.listAllRules).mockResolvedValue([] as never);
  });

  it("proposes a rule for a document the checklist never asked for", async () => {
    vi.mocked(checklistRepository.requestedItemsByPair).mockResolvedValue([
      requested(),
    ] as never);

    const { proposeRules } = await import("./checklist.service.js");
    const [proposal] = await proposeRules(auth);

    expect(proposal).toMatchObject({
      documentType: "Discharge summary",
      claimsRequested: 9,
      claimsSubmitted: 14,
      action: "add_required",
      insurerName: "Star Health",
    });
  });

  it("proposes promoting an optional rule rather than adding a second one", async () => {
    vi.mocked(checklistRepository.requestedItemsByPair).mockResolvedValue([
      requested({ requestedItem: "Copy of the discharge summary" }),
    ] as never);
    vi.mocked(checklistRepository.listAllRules).mockResolvedValue([
      rule({ required: false }),
    ] as never);

    const { proposeRules } = await import("./checklist.service.js");
    const [proposal] = await proposeRules(auth);

    expect(proposal).toMatchObject({
      action: "make_required",
      // The existing slot's wording, so accepting can't create a near-duplicate.
      documentType: "Discharge summary",
      requestedAs: ["Copy of the discharge summary"],
    });
  });

  it("says nothing when the rule is already required — that's a chase, not a rule change", async () => {
    vi.mocked(checklistRepository.requestedItemsByPair).mockResolvedValue([
      requested(),
    ] as never);
    vi.mocked(checklistRepository.listAllRules).mockResolvedValue([
      rule({ required: true }),
    ] as never);

    const { proposeRules } = await import("./checklist.service.js");
    expect(await proposeRules(auth)).toEqual([]);
  });

  it("collapses spellings of one document into a single proposal", async () => {
    vi.mocked(checklistRepository.requestedItemsByPair).mockResolvedValue([
      requested({ requestedItem: "Discharge summary", claimsRequested: 5 }),
      requested({ requestedItem: "Discharge summaries", claimsRequested: 3 }),
      requested({
        requestedItem: "Copy of the discharge summary",
        claimsRequested: 2,
      }),
    ] as never);

    const { proposeRules } = await import("./checklist.service.js");
    const proposals = await proposeRules(auth);

    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.claimsRequested).toBe(10);
    expect(proposals[0]!.requestedAs).toHaveLength(2);
  });

  it("never reports more claims than were submitted", async () => {
    // Two spellings across different claims can sum past the
    // denominator; a rate over 100% would discredit the whole list.
    vi.mocked(checklistRepository.requestedItemsByPair).mockResolvedValue([
      requested({ requestedItem: "Discharge summary", claimsRequested: 9 }),
      requested({ requestedItem: "discharge summaries", claimsRequested: 9 }),
    ] as never);

    const { proposeRules } = await import("./checklist.service.js");
    const [proposal] = await proposeRules(auth);
    expect(proposal!.claimsRequested).toBe(14);
  });

  it("ignores a pattern drawn from too few claims", async () => {
    vi.mocked(checklistRepository.requestedItemsByPair).mockResolvedValue([
      requested({ claimsRequested: 2, claimsSubmitted: 2 }),
    ] as never);

    const { proposeRules } = await import("./checklist.service.js");
    expect(await proposeRules(auth)).toEqual([]);
  });

  it("ignores something an insurer asked for once in fifty claims", async () => {
    vi.mocked(checklistRepository.requestedItemsByPair).mockResolvedValue([
      requested({ claimsRequested: 1, claimsSubmitted: 50 }),
    ] as never);

    const { proposeRules } = await import("./checklist.service.js");
    expect(await proposeRules(auth)).toEqual([]);
  });

  it("keeps each insurer and procedure pair separate", async () => {
    vi.mocked(checklistRepository.requestedItemsByPair).mockResolvedValue([
      requested(),
      requested({
        insurerId: "99999999-9999-9999-9999-999999999999",
        insurerName: "Niva Bupa",
      }),
    ] as never);

    const { proposeRules } = await import("./checklist.service.js");
    const proposals = await proposeRules(auth);

    expect(proposals).toHaveLength(2);
    expect(proposals.map((p) => p.insurerName).sort()).toEqual([
      "Niva Bupa",
      "Star Health",
    ]);
  });

  it("ranks the most consistent pattern first", async () => {
    vi.mocked(checklistRepository.requestedItemsByPair).mockResolvedValue([
      requested({ requestedItem: "Pharmacy bill", claimsRequested: 5 }),
      requested({ requestedItem: "ICU chart", claimsRequested: 13 }),
    ] as never);

    const { proposeRules } = await import("./checklist.service.js");
    const proposals = await proposeRules(auth);
    expect(proposals[0]!.documentType).toBe("ICU chart");
  });
});

describe("checklist.service.applyProposal", () => {
  const auth = { userId: USER_ID };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a required rule through the same path a desk head uses", async () => {
    vi.mocked(checklistRepository.createRule).mockResolvedValue({
      id: "new-rule",
      documentType: "ICU chart",
      required: true,
    } as never);

    const { applyProposal } = await import("./checklist.service.js");
    await applyProposal(auth, {
      insurerId: INSURER_ID,
      procedureId: PROCEDURE_ID,
      documentType: "ICU chart",
      action: "add_required",
    });

    expect(checklistRepository.createRule).toHaveBeenCalledWith({
      insurerId: INSURER_ID,
      procedureId: PROCEDURE_ID,
      documentType: "ICU chart",
      required: true,
    });
  });

  it("promotes an existing optional rule instead of duplicating it", async () => {
    vi.mocked(checklistRepository.listRules).mockResolvedValue([
      {
        id: "rule-1",
        documentType: "Discharge summary",
        required: false,
      },
    ] as never);
    vi.mocked(checklistRepository.updateRule).mockResolvedValue({
      id: "rule-1",
      documentType: "Discharge summary",
      required: true,
    } as never);

    const { applyProposal } = await import("./checklist.service.js");
    await applyProposal(auth, {
      insurerId: INSURER_ID,
      procedureId: PROCEDURE_ID,
      documentType: "Discharge summary",
      action: "make_required",
    });

    expect(checklistRepository.updateRule).toHaveBeenCalledWith("rule-1", {
      required: true,
    });
    expect(checklistRepository.createRule).not.toHaveBeenCalled();
  });

  it("raises RuleNotFoundError when the rule to promote has since been deleted", async () => {
    vi.mocked(checklistRepository.listRules).mockResolvedValue([] as never);

    const { applyProposal, RuleNotFoundError } =
      await import("./checklist.service.js");
    await expect(
      applyProposal(auth, {
        insurerId: INSURER_ID,
        procedureId: PROCEDURE_ID,
        documentType: "Discharge summary",
        action: "make_required",
      }),
    ).rejects.toThrow(RuleNotFoundError);
  });
});
