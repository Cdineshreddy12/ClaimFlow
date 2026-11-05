import { config } from "dotenv";
config({ path: "../../.env" });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { claims, insurers, procedures } from "../../db/schema.js";
import * as claimsRepository from "../claims/claims.repository.js";
import * as repo from "./enhancements.repository.js";

/**
 * The one write in this feature that has to be atomic: an approved
 * enhancement both records its outcome and raises the claim's ceiling.
 * If those two ever drift, the claim understates what the insurer
 * authorised and every shortfall computed from it is wrong — which is
 * the exact hole docs/adr/0012 exists to close.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "enhancements.repository (integration)",
  () => {
    // Unique per run: the suite's files run in parallel against one
    // database, and insurer names are unique (migration 0020).
    const INSURER_NAME = `Enh Test Insurer ${Date.now()}-${Math.random()
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
        .values({ name: "Enh Test Procedure" })
        .returning();
      insurerId = insurer!.id;
      procedureId = procedure!.id;

      const claim = await claimsRepository.createClaim(
        { patientName: "Enh Test Patient", insurerId, procedureId },
        [],
      );
      claimId = claim.id;
      await claimsRepository.updateConfirmedFacts(claimId, {
        sanctionedAmount: "200000.00",
      });
    });

    afterAll(async () => {
      await db.delete(claims).where(eq(claims.insurerId, insurerId));
      await db.delete(insurers).where(eq(insurers.id, insurerId));
      await db.delete(procedures).where(eq(procedures.id, procedureId));
    });

    it("creates a request, lists it, and finds it as the open one", async () => {
      const created = await repo.create(
        claimId,
        {
          requestedAmount: 80_000,
          reason: "Converted to open surgery",
          slaDeadline: new Date("2026-11-04T10:00:00.000Z"),
        },
        null,
      );
      expect(created?.status).toBe("REQUESTED");
      expect(created?.approvedAmount).toBeNull();

      const listed = await repo.listForClaim(claimId);
      expect(listed?.some((e) => e.id === created!.id)).toBe(true);

      const open = await repo.getOpenForClaim(claimId);
      expect(open?.id).toBe(created!.id);
    });

    it("raises the claim's sanctioned amount by exactly what was granted", async () => {
      const created = await repo.create(
        claimId,
        { requestedAmount: 80_000, reason: "ICU extension", slaDeadline: null },
        null,
      );

      const decided = await repo.decide(
        created!.id,
        "PARTIALLY_APPROVED",
        50_000,
      );
      expect(decided?.status).toBe("PARTIALLY_APPROVED");
      expect(Number(decided?.approvedAmount)).toBe(50_000);
      expect(decided?.decidedAt).not.toBeNull();

      const claim = await claimsRepository.getClaimById(claimId);
      // 200,000 sanctioned + 50,000 granted. Not the 80,000 asked for.
      expect(Number(claim?.sanctionedAmount)).toBe(250_000);
    });

    it("leaves the ceiling untouched on a rejection", async () => {
      const before = await claimsRepository.getClaimById(claimId);
      const created = await repo.create(
        claimId,
        { requestedAmount: 40_000, reason: "Extra physio", slaDeadline: null },
        null,
      );

      await repo.decide(created!.id, "REJECTED", undefined);

      const after = await claimsRepository.getClaimById(claimId);
      expect(Number(after?.sanctionedAmount)).toBe(
        Number(before?.sanctionedAmount),
      );
    });

    it("treats a zero approval as a decision, not a grant", async () => {
      const before = await claimsRepository.getClaimById(claimId);
      const created = await repo.create(
        claimId,
        { requestedAmount: 10_000, reason: "Dressings", slaDeadline: null },
        null,
      );

      const decided = await repo.decide(created!.id, "PARTIALLY_APPROVED", 0);
      expect(Number(decided?.approvedAmount)).toBe(0);
      const after = await claimsRepository.getClaimById(claimId);
      expect(Number(after?.sanctionedAmount)).toBe(
        Number(before?.sanctionedAmount),
      );
    });

    it("builds a ceiling from an enhancement even when none was recorded", async () => {
      const fresh = await claimsRepository.createClaim(
        { patientName: "Enh No Sanction", insurerId, procedureId },
        [],
      );
      const created = await repo.create(
        fresh.id,
        { requestedAmount: 30_000, reason: "Unbudgeted", slaDeadline: null },
        null,
      );

      await repo.decide(created!.id, "APPROVED", 30_000);

      // coalesce(null, 0) + 30,000 — without it this would have stayed null.
      const claim = await claimsRepository.getClaimById(fresh.id);
      expect(Number(claim?.sanctionedAmount)).toBe(30_000);
    });

    it("sums what every enhancement granted on a claim", async () => {
      const total = await repo.approvedTotalForClaim(claimId);
      // 50,000 from the partial approval, 0 from the zero one, nothing
      // from the rejection.
      expect(total).toBe(50_000);
    });

    it("returns undefined for a claim that doesn't exist", async () => {
      const missing = "00000000-0000-4000-8000-000000000000";
      expect(await repo.listForClaim(missing)).toBeUndefined();
      expect(
        await repo.create(
          missing,
          { requestedAmount: 1, reason: "x", slaDeadline: null },
          null,
        ),
      ).toBeUndefined();
    });
  },
);
