import { config } from "dotenv";
config({ path: "../../.env" });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { insurers, organizations, procedures } from "../../db/schema.js";
import * as checklistRepository from "./checklist.repository.js";
import * as claimsRepository from "../claims/claims.repository.js";

describe.skipIf(!process.env.DATABASE_URL)(
  "checklist.repository (integration)",
  () => {
    let organizationId: string;
    let insurerId: string;
    let procedureId: string;

    beforeAll(async () => {
      const [org] = await db
        .insert(organizations)
        .values({
          name: "Checklist Test Org",
          slug: `test-checklist-${Date.now()}`,
        })
        .returning();
      const [insurer] = await db
        .insert(insurers)
        .values({ name: "Test Insurer", type: "tpa" })
        .returning();
      const [procedure] = await db
        .insert(procedures)
        .values({ name: "Test Procedure" })
        .returning();
      organizationId = org!.id;
      insurerId = insurer!.id;
      procedureId = procedure!.id;
    });

    afterAll(async () => {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
      await db.delete(insurers).where(eq(insurers.id, insurerId));
      await db.delete(procedures).where(eq(procedures.id, procedureId));
    });

    it("creates, lists, updates, and deletes a rule", async () => {
      const created = await checklistRepository.createRule(organizationId, {
        insurerId,
        procedureId,
        documentType: "Pre-authorization form",
        required: true,
      });
      expect(created.required).toBe(true);

      const rules = await checklistRepository.listRules(
        organizationId,
        insurerId,
        procedureId,
      );
      expect(rules.map((r) => r.documentType)).toContain(
        "Pre-authorization form",
      );

      const updated = await checklistRepository.updateRule(
        organizationId,
        created.id,
        { required: false },
      );
      expect(updated?.required).toBe(false);

      const deleted = await checklistRepository.deleteRule(
        organizationId,
        created.id,
      );
      expect(deleted?.id).toBe(created.id);

      const afterDelete = await checklistRepository.listRules(
        organizationId,
        insurerId,
        procedureId,
      );
      expect(afterDelete.find((r) => r.id === created.id)).toBeUndefined();
    });

    it("rejects a duplicate (org, insurer, procedure, documentType) rule at the database level", async () => {
      await checklistRepository.createRule(organizationId, {
        insurerId,
        procedureId,
        documentType: "Photo ID proof",
        required: true,
      });

      await expect(
        checklistRepository.createRule(organizationId, {
          insurerId,
          procedureId,
          documentType: "Photo ID proof",
          required: false,
        }),
      ).rejects.toThrow();
    });

    it("counts only non-terminal claims as active", async () => {
      const claim = await claimsRepository.createClaim(
        organizationId,
        { patientName: "Count Test Patient", insurerId, procedureId },
        [],
      );

      const activeBefore = await checklistRepository.countActiveClaimsFor(
        organizationId,
        insurerId,
        procedureId,
      );
      expect(activeBefore).toBeGreaterThanOrEqual(1);

      await claimsRepository.recordStatusChange(
        organizationId,
        claim.id,
        "REJECTED",
        null,
        undefined,
      );

      const activeAfter = await checklistRepository.countActiveClaimsFor(
        organizationId,
        insurerId,
        procedureId,
      );
      expect(activeAfter).toBe(activeBefore - 1);
    });
  },
);
