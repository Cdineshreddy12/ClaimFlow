import { config } from "dotenv";
config({ path: "../../.env" });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { insurers, organizations, procedures } from "../../db/schema.js";
import * as claimsRepository from "../claims/claims.repository.js";
import * as documentsRepository from "./documents.repository.js";

describe.skipIf(!process.env.DATABASE_URL)(
  "documents.repository (integration)",
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
          name: "Documents Test Org",
          slug: `test-documents-${Date.now()}`,
        })
        .returning();
      const [otherOrg] = await db
        .insert(organizations)
        .values({ name: "Other Org", slug: `test-other-org-${Date.now()}` })
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
        { patientName: "Doc Test Patient", insurerId, procedureId },
        [{ documentType: "Pre-authorization form", required: true }],
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

    it("creates, lists, confirms, and deletes a document", async () => {
      const created = await documentsRepository.create(
        organizationId,
        claimId,
        { fileUrl: "organizations/x/doc.pdf" },
      );
      expect(created?.confirmedAt).toBeNull();

      const listed = await documentsRepository.listForClaim(
        organizationId,
        claimId,
      );
      expect(listed?.some((d) => d.id === created!.id)).toBe(true);

      const confirmed = await documentsRepository.confirm(
        organizationId,
        claimId,
        created!.id,
        "Pre-authorization form",
        null,
      );
      expect(confirmed?.checklistSlot).toBe("Pre-authorization form");
      expect(confirmed?.confirmedAt).not.toBeNull();

      const deleted = await documentsRepository.remove(
        organizationId,
        claimId,
        created!.id,
      );
      expect(deleted?.id).toBe(created!.id);
    });

    it("returns undefined for every operation when the claim belongs to a different organization", async () => {
      const list = await documentsRepository.listForClaim(
        otherOrganizationId,
        claimId,
      );
      expect(list).toBeUndefined();

      const created = await documentsRepository.create(
        otherOrganizationId,
        claimId,
        { fileUrl: "x.pdf" },
      );
      expect(created).toBeUndefined();
    });

    it("confirmedSlotsForClaim only returns slots with both a checklistSlot and a confirmedAt", async () => {
      const unconfirmed = await documentsRepository.create(
        organizationId,
        claimId,
        { fileUrl: "unconfirmed.pdf" },
      );
      const confirmedDoc = await documentsRepository.create(
        organizationId,
        claimId,
        { fileUrl: "confirmed.pdf" },
      );
      await documentsRepository.confirm(
        organizationId,
        claimId,
        confirmedDoc!.id,
        "Pre-authorization form",
        null,
      );

      const slots = await documentsRepository.confirmedSlotsForClaim(claimId);
      expect(slots).toEqual(["Pre-authorization form"]);

      await documentsRepository.remove(
        organizationId,
        claimId,
        unconfirmed!.id,
      );
      await documentsRepository.remove(
        organizationId,
        claimId,
        confirmedDoc!.id,
      );
    });
  },
);
