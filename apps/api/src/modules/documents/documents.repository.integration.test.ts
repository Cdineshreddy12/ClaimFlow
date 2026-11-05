import { config } from "dotenv";
config({ path: "../../.env" });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { claims, insurers, procedures } from "../../db/schema.js";
import * as claimsRepository from "../claims/claims.repository.js";
import * as documentsRepository from "./documents.repository.js";

describe.skipIf(!process.env.DATABASE_URL)(
  "documents.repository (integration)",
  () => {
    // Unique per run: the suite's files run in parallel against one
    // database, and insurer names are unique (migration 0020).
    const INSURER_NAME = `Test Insurer ${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    let insurerId: string;
    let procedureId: string;
    let claimId: string;

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

      const claim = await claimsRepository.createClaim(
        { patientName: "Doc Test Patient", insurerId, procedureId },
        [{ documentType: "Pre-authorization form", required: true }],
      );
      claimId = claim.id;
    });

    afterAll(async () => {
      // The organization used to cascade these away on delete. Without
      // it the claims hold a foreign key onto the insurer below.
      await db.delete(claims).where(eq(claims.insurerId, insurerId));
      await db.delete(insurers).where(eq(insurers.id, insurerId));
      await db.delete(procedures).where(eq(procedures.id, procedureId));
    });

    it("creates, lists, confirms, and deletes a document", async () => {
      const created = await documentsRepository.create(claimId, {
        fileUrl: "organizations/x/doc.pdf",
      });
      expect(created?.confirmedAt).toBeNull();

      const listed = await documentsRepository.listForClaim(claimId);
      expect(listed?.some((d) => d.id === created!.id)).toBe(true);

      const confirmed = await documentsRepository.confirm(
        claimId,
        created!.id,
        "Pre-authorization form",
        null,
      );
      expect(confirmed?.checklistSlot).toBe("Pre-authorization form");
      expect(confirmed?.confirmedAt).not.toBeNull();

      const deleted = await documentsRepository.remove(claimId, created!.id);
      expect(deleted?.id).toBe(created!.id);
    });

    // The cross-organization tests that sat here went with
    // multi-tenancy — there is no other organization to be refused
    // from. What still holds is that an unknown claim id yields
    // nothing rather than throwing, so that is what's pinned now.
    it("returns undefined for every operation on a claim that doesn't exist", async () => {
      const missing = "00000000-0000-0000-0000-000000000000";
      expect(await documentsRepository.listForClaim(missing)).toBeUndefined();
      expect(
        await documentsRepository.create(missing, { fileUrl: "x.pdf" }),
      ).toBeUndefined();
    });

    it("confirmedSlotsForClaim only returns slots with both a checklistSlot and a confirmedAt", async () => {
      const unconfirmed = await documentsRepository.create(claimId, {
        fileUrl: "unconfirmed.pdf",
      });
      const confirmedDoc = await documentsRepository.create(claimId, {
        fileUrl: "confirmed.pdf",
      });
      await documentsRepository.confirm(
        claimId,
        confirmedDoc!.id,
        "Pre-authorization form",
        null,
      );

      const slots = await documentsRepository.confirmedSlotsForClaim(claimId);
      expect(slots).toEqual(["Pre-authorization form"]);

      await documentsRepository.remove(claimId, unconfirmed!.id);
      await documentsRepository.remove(claimId, confirmedDoc!.id);
    });
  },
);
