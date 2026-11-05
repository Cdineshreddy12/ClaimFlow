import { config } from "dotenv";
config({ path: "../../.env" });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import {
  checklistRules,
  claims,
  insurers,
  procedures,
  queries,
} from "../../db/schema.js";
import * as checklistRepository from "./checklist.repository.js";
import * as claimsRepository from "../claims/claims.repository.js";

describe.skipIf(!process.env.DATABASE_URL)(
  "checklist.repository (integration)",
  () => {
    // Unique per run: the suite's files run in parallel against one
    // database, and insurer names are unique (migration 0020).
    const INSURER_NAME = `Test Insurer ${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    let insurerId: string;
    let procedureId: string;

    beforeAll(async () => {
      const [insurer] = await db
        .insert(insurers)
        .values({ name: INSURER_NAME, type: "tpa" })
        .returning();
      const [procedure] = await db
        .insert(procedures)
        .values({ name: "Test Procedure" })
        .returning();
      insurerId = insurer!.id;
      procedureId = procedure!.id;
    });

    afterAll(async () => {
      // The organization used to cascade these away on delete. Without
      // it the rules and claims hold foreign keys onto the insurer below.
      await db
        .delete(checklistRules)
        .where(eq(checklistRules.insurerId, insurerId));
      await db.delete(claims).where(eq(claims.insurerId, insurerId));
      await db.delete(insurers).where(eq(insurers.id, insurerId));
      await db.delete(procedures).where(eq(procedures.id, procedureId));
    });

    it("creates, lists, updates, and deletes a rule", async () => {
      const created = await checklistRepository.createRule({
        insurerId,
        procedureId,
        documentType: "Pre-authorization form",
        required: true,
      });
      expect(created.required).toBe(true);

      const rules = await checklistRepository.listRules(insurerId, procedureId);
      expect(rules.map((r) => r.documentType)).toContain(
        "Pre-authorization form",
      );

      const updated = await checklistRepository.updateRule(created.id, {
        required: false,
      });
      expect(updated?.required).toBe(false);

      const deleted = await checklistRepository.deleteRule(created.id);
      expect(deleted?.id).toBe(created.id);

      const afterDelete = await checklistRepository.listRules(
        insurerId,
        procedureId,
      );
      expect(afterDelete.find((r) => r.id === created.id)).toBeUndefined();
    });

    it("rejects a duplicate (insurer, procedure, documentType) rule at the database level", async () => {
      await checklistRepository.createRule({
        insurerId,
        procedureId,
        documentType: "Photo ID proof",
        required: true,
      });

      await expect(
        checklistRepository.createRule({
          insurerId,
          procedureId,
          documentType: "Photo ID proof",
          required: false,
        }),
      ).rejects.toThrow();
    });

    it("counts only non-terminal claims as active", async () => {
      const claim = await claimsRepository.createClaim(
        { patientName: "Count Test Patient", insurerId, procedureId },
        [],
      );

      const activeBefore = await checklistRepository.countActiveClaimsFor(
        insurerId,
        procedureId,
      );
      expect(activeBefore).toBeGreaterThanOrEqual(1);

      await claimsRepository.recordStatusChange(
        claim.id,
        "REJECTED",
        null,
        undefined,
      );

      const activeAfter = await checklistRepository.countActiveClaimsFor(
        insurerId,
        procedureId,
      );
      expect(activeAfter).toBe(activeBefore - 1);
    });

    /**
     * `requestedItemsByPair` is hand-written SQL that unnests a jsonb
     * array through a lateral join. The row shapes and the distinct
     * counting come from Postgres, not from TypeScript, so this is the
     * only place the proposal pipeline is actually proven.
     */
    describe("requestedItemsByPair", () => {
      it("unnests requested items and counts the claims that asked for each", async () => {
        const first = await claimsRepository.createClaim(
          { patientName: "Query Learn A", insurerId, procedureId },
          [],
        );
        const second = await claimsRepository.createClaim(
          { patientName: "Query Learn B", insurerId, procedureId },
          [],
        );
        const draft = await claimsRepository.createClaim(
          { patientName: "Query Learn Draft", insurerId, procedureId },
          [],
        );
        for (const claim of [first, second]) {
          await db
            .update(claims)
            .set({ status: "PRE_AUTH_SENT" })
            .where(eq(claims.id, claim.id));
        }

        await db.insert(queries).values([
          {
            claimId: first.id,
            tpaRawEmail: "...",
            requestedItems: ["ICU chart", "Discharge summary"],
          },
          // Same claim asking twice for one item is one claim, not two.
          {
            claimId: first.id,
            tpaRawEmail: "...",
            requestedItems: ["ICU chart"],
          },
          {
            claimId: second.id,
            tpaRawEmail: "...",
            requestedItems: ["ICU chart"],
          },
          // A draft claim was never sent, so it could never have been
          // queried — it must not appear in either half of the ratio.
          {
            claimId: draft.id,
            tpaRawEmail: "...",
            requestedItems: ["Never submitted item"],
          },
        ]);

        const rows = await checklistRepository.requestedItemsByPair();
        const mine = rows.filter((row) => row.procedureId === procedureId);

        const icu = mine.find((row) => row.requestedItem === "ICU chart");
        expect(icu?.claimsRequested).toBe(2);
        expect(icu?.claimsSubmitted).toBeGreaterThanOrEqual(2);
        expect(icu?.insurerName).toBe(INSURER_NAME);

        const summary = mine.find(
          (row) => row.requestedItem === "Discharge summary",
        );
        expect(summary?.claimsRequested).toBe(1);

        expect(
          mine.some((row) => row.requestedItem === "Never submitted item"),
        ).toBe(false);
      });
    });
  },
);
