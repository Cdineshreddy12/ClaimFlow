import { config } from "dotenv";
config({ path: "../../.env" });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { insurers, organizations, procedures } from "../../db/schema.js";
import * as claimsRepository from "../claims/claims.repository.js";
import * as queriesRepository from "./queries.repository.js";

describe.skipIf(!process.env.DATABASE_URL)(
  "queries.repository (integration)",
  () => {
    let organizationId: string;
    let otherOrganizationId: string;
    let insurerId: string;
    let procedureId: string;
    let claimId: string;

    beforeAll(async () => {
      const [org] = await db
        .insert(organizations)
        .values({
          name: "Queries Test Org",
          slug: `test-queries-${Date.now()}`,
        })
        .returning();
      const [otherOrg] = await db
        .insert(organizations)
        .values({ name: "Other Org", slug: `test-queries-other-${Date.now()}` })
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
      otherOrganizationId = otherOrg!.id;
      insurerId = insurer!.id;
      procedureId = procedure!.id;

      const claim = await claimsRepository.createClaim(
        organizationId,
        { patientName: "Query Test Patient", insurerId, procedureId },
        [],
      );
      claimId = claim.id;
    });

    afterAll(async () => {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
      await db
        .delete(organizations)
        .where(eq(organizations.id, otherOrganizationId));
      await db.delete(insurers).where(eq(insurers.id, insurerId));
      await db.delete(procedures).where(eq(procedures.id, procedureId));
    });

    it("creates a query, lists it for the claim, and reads it back by id", async () => {
      const created = await queriesRepository.create(organizationId, claimId, {
        tpaRawEmail: "Dear Team, the ultrasound report is missing...",
        requestedItems: ["Ultrasound report (abdomen)"],
      });
      expect(created?.aiSummary).toBeNull();

      const listed = await queriesRepository.listForClaim(
        organizationId,
        claimId,
      );
      expect(listed?.some((q) => q.id === created!.id)).toBe(true);

      const fetched = await queriesRepository.getById(
        organizationId,
        created!.id,
      );
      expect(fetched?.tpaRawEmail).toContain("ultrasound report is missing");
    });

    it("returns undefined for a query read under the wrong organization", async () => {
      const created = await queriesRepository.create(organizationId, claimId, {
        tpaRawEmail: "...",
        requestedItems: [],
      });

      const wrongOrg = await queriesRepository.getById(
        otherOrganizationId,
        created!.id,
      );
      expect(wrongOrg).toBeUndefined();
    });

    it("markReplied stamps replySentAt, and listInbox respects the open/replied/all filter", async () => {
      const openQuery = await queriesRepository.create(
        organizationId,
        claimId,
        {
          tpaRawEmail: "still open",
          requestedItems: [],
        },
      );
      const toBeReplied = await queriesRepository.create(
        organizationId,
        claimId,
        {
          tpaRawEmail: "will be replied",
          requestedItems: [],
        },
      );
      await queriesRepository.markReplied(organizationId, toBeReplied!.id);

      const open = await queriesRepository.listInbox(organizationId, {
        status: "open",
      });
      expect(open.some((q) => q.id === openQuery!.id)).toBe(true);
      expect(open.some((q) => q.id === toBeReplied!.id)).toBe(false);

      const replied = await queriesRepository.listInbox(organizationId, {
        status: "replied",
      });
      expect(replied.some((q) => q.id === toBeReplied!.id)).toBe(true);
      expect(replied.some((q) => q.id === openQuery!.id)).toBe(false);

      const all = await queriesRepository.listInbox(organizationId, {
        status: "all",
      });
      expect(all.some((q) => q.id === openQuery!.id)).toBe(true);
      expect(all.some((q) => q.id === toBeReplied!.id)).toBe(true);
    });

    it("update patches only the fields given", async () => {
      const created = await queriesRepository.create(organizationId, claimId, {
        tpaRawEmail: "...",
        requestedItems: ["A"],
        aiSummary: "original summary",
      });

      const updated = await queriesRepository.update(
        organizationId,
        created!.id,
        { aiSummary: "corrected summary" },
      );
      expect(updated?.aiSummary).toBe("corrected summary");
      expect(updated?.requestedItems).toEqual(["A"]);
    });
  },
);
