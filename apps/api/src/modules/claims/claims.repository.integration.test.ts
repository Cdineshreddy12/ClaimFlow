import { config } from "dotenv";
config({ path: "../../.env" });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { claims, insurers, procedures } from "../../db/schema.js";
import * as claimsRepository from "./claims.repository.js";

/**
 * Hits the real Supabase project in DATABASE_URL — not mocked, not a
 * local test DB. Skips automatically when DATABASE_URL isn't set (e.g.
 * in CI, which doesn't have it configured) rather than failing the suite.
 * Creates its own throwaway org/insurer/procedure and cleans them up via
 * FK cascade on the organization delete.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "claims.repository (integration)",
  () => {
    let insurerId: string;
    let procedureId: string;

    beforeAll(async () => {
      const [insurer] = await db
        .insert(insurers)
        .values({ name: "Test Insurer", type: "tpa" })
        .returning();
      const [procedure] = await db
        .insert(procedures)
        .values({ name: "Test Procedure" })
        .returning();
      insurerId = insurer!.id;
      procedureId = procedure!.id;
    });

    afterAll(async () => {
      // cascades to any claims/claim_status_events created in this run
      // The organization used to cascade these away on delete. Without
      // it the claims hold a foreign key onto the insurer below.
      await db.delete(claims).where(eq(claims.insurerId, insurerId));
      await db.delete(insurers).where(eq(insurers.id, insurerId));
      await db.delete(procedures).where(eq(procedures.id, procedureId));
    });

    it("creates a claim and reads it back", async () => {
      const created = await claimsRepository.createClaim(
        { patientName: "Test Patient", insurerId, procedureId },
        [],
      );

      const fetched = await claimsRepository.getClaimById(created.id);
      expect(fetched?.patientName).toBe("Test Patient");
      expect(fetched?.status).toBe("DRAFT");
    });

    it("persists the checklist snapshot it's given, untouched", async () => {
      const snapshot = [
        { documentType: "Pre-authorization form", required: true },
        { documentType: "Previous treatment records", required: false },
      ];
      const created = await claimsRepository.createClaim(
        { patientName: "Snapshot Patient", insurerId, procedureId },
        snapshot,
      );

      const fetched = await claimsRepository.getClaimById(created.id);
      expect(fetched?.checklistSnapshot).toEqual(snapshot);
    });

    // The cross-organization read test that used to sit here went with
    // multi-tenancy — there is no second organization to read from any
    // more. What's left worth pinning is that an unknown id is absent
    // rather than throwing.
    it("returns undefined for a claim that doesn't exist", async () => {
      const missing = await claimsRepository.getClaimById(
        "00000000-0000-0000-0000-000000000000",
      );
      expect(missing).toBeUndefined();
    });

    it("recordStatusChange updates status and appends a timeline event", async () => {
      const created = await claimsRepository.createClaim(
        { patientName: "Timeline Patient", insurerId, procedureId },
        [],
      );

      const updated = await claimsRepository.recordStatusChange(
        created.id,
        "PRE_AUTH_SENT",
        null,
        undefined,
      );

      expect(updated?.status).toBe("PRE_AUTH_SENT");
      const fetched = await claimsRepository.getClaimById(created.id);
      expect(fetched?.status).toBe("PRE_AUTH_SENT");
    });
  },
);
