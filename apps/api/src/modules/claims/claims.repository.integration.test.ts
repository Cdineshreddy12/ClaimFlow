import { config } from "dotenv";
config({ path: "../../.env" });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { insurers, organizations, procedures } from "../../db/schema.js";
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
    let organizationId: string;
    let insurerId: string;
    let procedureId: string;

    beforeAll(async () => {
      const [org] = await db
        .insert(organizations)
        .values({
          name: "Integration Test Org",
          slug: `test-org-${Date.now()}`,
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
      // cascades to any claims/claim_status_events created in this run
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
      await db.delete(insurers).where(eq(insurers.id, insurerId));
      await db.delete(procedures).where(eq(procedures.id, procedureId));
    });

    it("creates a claim and reads it back scoped to its organization", async () => {
      const created = await claimsRepository.createClaim(organizationId, {
        patientName: "Test Patient",
        insurerId,
        procedureId,
      });

      const fetched = await claimsRepository.getClaimById(
        organizationId,
        created.id,
      );
      expect(fetched?.patientName).toBe("Test Patient");
      expect(fetched?.status).toBe("DRAFT");
    });

    it("does not return a claim when queried under a different organization", async () => {
      const created = await claimsRepository.createClaim(organizationId, {
        patientName: "Another Patient",
        insurerId,
        procedureId,
      });

      const wrongOrgResult = await claimsRepository.getClaimById(
        "00000000-0000-0000-0000-000000000000",
        created.id,
      );
      expect(wrongOrgResult).toBeUndefined();
    });

    it("recordStatusChange updates status and appends a timeline event", async () => {
      const created = await claimsRepository.createClaim(organizationId, {
        patientName: "Timeline Patient",
        insurerId,
        procedureId,
      });

      const updated = await claimsRepository.recordStatusChange(
        organizationId,
        created.id,
        "PRE_AUTH_SENT",
        null,
        undefined,
      );

      expect(updated?.status).toBe("PRE_AUTH_SENT");
      const fetched = await claimsRepository.getClaimById(
        organizationId,
        created.id,
      );
      expect(fetched?.status).toBe("PRE_AUTH_SENT");
    });
  },
);
