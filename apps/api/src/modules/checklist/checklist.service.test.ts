import { beforeEach, describe, expect, it, vi } from "vitest";
import * as checklistRepository from "./checklist.repository.js";

vi.mock("./checklist.repository.js");

const ORG_ID = "11111111-1111-1111-1111-111111111111";
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
          { organizationId: ORG_ID },
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
          { organizationId: ORG_ID },
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
        updateRule({ organizationId: ORG_ID }, "missing-id", {
          required: false,
        }),
      ).rejects.toThrow(RuleNotFoundError);
    });

    it("raises RuleNotFoundError when the delete affects no row", async () => {
      vi.mocked(checklistRepository.deleteRule).mockResolvedValue(undefined);

      const { deleteRule, RuleNotFoundError } =
        await import("./checklist.service.js");

      await expect(
        deleteRule({ organizationId: ORG_ID }, "missing-id"),
      ).rejects.toThrow(RuleNotFoundError);
    });
  });

  describe("getRequirementsSnapshot", () => {
    it("reduces rules down to the documentType/required shape stored on a claim", async () => {
      vi.mocked(checklistRepository.listRules).mockResolvedValue([
        {
          id: "r1",
          organizationId: ORG_ID,
          insurerId: INSURER_ID,
          procedureId: PROCEDURE_ID,
          documentType: "Pre-auth form",
          required: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "r2",
          organizationId: ORG_ID,
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
      const snapshot = await getRequirementsSnapshot(
        ORG_ID,
        INSURER_ID,
        PROCEDURE_ID,
      );

      expect(snapshot).toEqual([
        { documentType: "Pre-auth form", required: true },
        { documentType: "Previous records", required: false },
      ]);
    });
  });
});
