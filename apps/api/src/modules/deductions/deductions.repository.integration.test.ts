import { config } from "dotenv";
config({ path: "../../.env" });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { claims, deductions, insurers, procedures } from "../../db/schema.js";
import * as claimsRepository from "../claims/claims.repository.js";
import * as repo from "./deductions.repository.js";

/**
 * The aggregate behind the risk panel, against real SQL. Every
 * assertion here is a number a desk exec reads as a percentage, so the
 * distinct-claim counting and the SETTLED-only denominator are the
 * whole point — both are the kind of thing that passes a mocked test
 * and quietly reports 150% in production.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "deductions.repository (integration)",
  () => {
    // Unique per run: the suite's files run in parallel against one
    // database, and insurer names are unique (migration 0020).
    const INSURER_NAME = `Risk Test Insurer ${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    let insurerId: string;
    let procedureId: string;
    let otherProcedureId: string;
    /** The claim being assessed — must never count as its own evidence. */
    let subjectClaimId: string;

    async function settledClaim(
      patientName: string,
      procedure: string,
    ): Promise<string> {
      const claim = await claimsRepository.createClaim(
        { patientName, insurerId, procedureId: procedure },
        [],
      );
      await db
        .update(claims)
        .set({ status: "SETTLED" })
        .where(eq(claims.id, claim.id));
      return claim.id;
    }

    async function cut(
      claimId: string,
      reason: string,
      amount: number,
    ): Promise<void> {
      await db
        .insert(deductions)
        .values({ claimId, reason, amount: amount.toString() });
    }

    beforeAll(async () => {
      const [insurer] = await db
        .insert(insurers)
        .values({ name: INSURER_NAME, type: "tpa" })
        .returning();
      const [procedure] = await db
        .insert(procedures)
        .values({ name: "Risk Test Procedure" })
        .returning();
      const [other] = await db
        .insert(procedures)
        .values({ name: "Risk Test Other Procedure" })
        .returning();
      insurerId = insurer!.id;
      procedureId = procedure!.id;
      otherProcedureId = other!.id;

      // Three settled claims for the procedure under test. The first
      // lost money twice to the same reason — one claim, not two.
      const a = await settledClaim("Risk Patient A", procedureId);
      await cut(a, "missing_document", 30_000);
      await cut(a, "missing_document", 20_000);

      const b = await settledClaim("Risk Patient B", procedureId);
      await cut(b, "missing_document", 50_000);

      await settledClaim("Risk Patient C", procedureId);

      // A settled claim for a different procedure, same insurer: in the
      // wide scope only.
      const d = await settledClaim("Risk Patient D", otherProcedureId);
      await cut(d, "documentation_delay", 15_000);

      // Still in flight, and carrying a deduction row that must not be
      // counted: it hasn't settled, so it isn't evidence yet.
      const inFlight = await claimsRepository.createClaim(
        { patientName: "Risk Patient E", insurerId, procedureId },
        [],
      );
      await cut(inFlight.id, "missing_document", 999_000);

      // The claim being assessed, itself settled with a deduction.
      subjectClaimId = await settledClaim("Risk Subject", procedureId);
      await cut(subjectClaimId, "missing_document", 777_000);
    });

    afterAll(async () => {
      await db.delete(claims).where(eq(claims.insurerId, insurerId));
      await db.delete(insurers).where(eq(insurers.id, insurerId));
      await db.delete(procedures).where(eq(procedures.id, procedureId));
      await db.delete(procedures).where(eq(procedures.id, otherProcedureId));
    });

    it("counts a claim once per reason however many times it was cut", async () => {
      const history = await repo.settledHistoryForScope({
        insurerId,
        procedureId,
        excludeClaimId: subjectClaimId,
      });

      const missing = history.byReason.find(
        (r) => r.reason === "missing_document",
      );
      // Patients A and B, not three rows.
      expect(missing?.claimsAffected).toBe(2);
      // Every rupee still counts, though: 30k + 20k + 50k.
      expect(missing?.total).toBe(100_000);
    });

    it("counts only settled claims in the denominator", async () => {
      const history = await repo.settledHistoryForScope({
        insurerId,
        procedureId,
        excludeClaimId: subjectClaimId,
      });

      // A, B and C. Not the in-flight claim, and not the subject.
      expect(history.claimsConsidered).toBe(3);
    });

    it("never lets the claim being assessed be its own evidence", async () => {
      const history = await repo.settledHistoryForScope({
        insurerId,
        procedureId,
        excludeClaimId: subjectClaimId,
      });

      const missing = history.byReason.find(
        (r) => r.reason === "missing_document",
      );
      // The subject's own ₹777,000 would dominate the average.
      expect(missing?.total).toBe(100_000);
      expect(missing?.claimsAffected).toBe(2);
    });

    it("excludes an in-flight claim's deductions from the reason totals", async () => {
      const history = await repo.settledHistoryForScope({
        insurerId,
        procedureId,
        excludeClaimId: subjectClaimId,
      });

      expect(
        history.byReason.find((r) => r.reason === "missing_document")?.total,
      ).not.toBe(1_099_000);
    });

    it("narrows to the procedure, and widens to the insurer when asked", async () => {
      const narrow = await repo.settledHistoryForScope({
        insurerId,
        procedureId,
        excludeClaimId: subjectClaimId,
      });
      const wide = await repo.settledHistoryForScope({
        insurerId,
        excludeClaimId: subjectClaimId,
      });

      expect(narrow.byReason.map((r) => r.reason)).not.toContain(
        "documentation_delay",
      );
      // The other procedure's claim and its deduction only appear wide.
      expect(wide.claimsConsidered).toBe(4);
      expect(
        wide.byReason.find((r) => r.reason === "documentation_delay")?.total,
      ).toBe(15_000);
    });

    it("records an appeal and nets the recovery out of the reason's total", async () => {
      const claimId = await settledClaim("Risk Appeal", procedureId);
      await cut(claimId, "missing_document", 60_000);
      const [row] = await db
        .select()
        .from(deductions)
        .where(eq(deductions.claimId, claimId));

      const contested = await repo.contest(row!.id, "Sent on the 3rd");
      expect(contested?.appealStatus).toBe("CONTESTED");
      expect(contested?.contestedAt).not.toBeNull();

      const resolved = await repo.resolveAppeal(
        row!.id,
        "PARTIALLY_RECOVERED",
        25_000,
        "Insurer restored part of it",
      );
      expect(Number(resolved?.recoveredAmount)).toBe(25_000);
      expect(resolved?.resolvedAt).not.toBeNull();

      // The history aggregate now carries both numbers.
      const history = await repo.settledHistoryForScope({
        insurerId,
        procedureId,
        excludeClaimId: subjectClaimId,
      });
      const missing = history.byReason.find(
        (r) => r.reason === "missing_document",
      );
      expect(missing?.recovered).toBe(25_000);

      const totals = await repo.totalsForClaim(claimId);
      expect(totals).toEqual({ deducted: 60_000, recovered: 25_000 });
    });

    it("lists only the deductions still worth chasing by default", async () => {
      const worklist = await repo.listAppealWorklist({});
      for (const row of worklist) {
        expect(["NOT_CONTESTED", "CONTESTED"]).toContain(row.appealStatus);
      }
      // And carries the claim's own identifiers, so the list reads
      // without a second query per row.
      const mine = worklist.find((r) => r.patientName === "Risk Patient A");
      expect(mine?.claimReference).toMatch(/^CLM-/);
      expect(mine?.insurerName).toBe(INSURER_NAME);
    });

    it("can be filtered to a resolved outcome", async () => {
      const resolved = await repo.listAppealWorklist({
        status: "PARTIALLY_RECOVERED",
      });
      expect(
        resolved.every((r) => r.appealStatus === "PARTIALLY_RECOVERED"),
      ).toBe(true);
      // The one this suite just resolved is in it.
      expect(resolved.some((r) => r.patientName === "Risk Appeal")).toBe(true);
    });

    it("reports an empty history for an insurer with nothing settled", async () => {
      const [fresh] = await db
        .insert(insurers)
        .values({
          name: `Risk Test Fresh Insurer ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: "insurer",
        })
        .returning();

      const history = await repo.settledHistoryForScope({
        insurerId: fresh!.id,
        excludeClaimId: subjectClaimId,
      });

      expect(history.claimsConsidered).toBe(0);
      expect(history.byReason).toEqual([]);

      await db.delete(insurers).where(eq(insurers.id, fresh!.id));
    });
  },
);
