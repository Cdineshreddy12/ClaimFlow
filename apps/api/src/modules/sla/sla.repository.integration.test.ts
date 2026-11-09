import { config } from "dotenv";
config({ path: "../../.env" });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import {
  claimStatusEvents,
  claims,
  insurers,
  procedures,
} from "../../db/schema.js";
import * as claimsRepository from "../claims/claims.repository.js";
import * as repo from "./sla.repository.js";

/**
 * Both queries here are hand-written SQL — `distinct on` for the latest
 * event per claim, and a `lead()` window for how long the insurer took.
 * Neither is expressible in the query builder, and neither can be
 * trusted from a mocked test: the row shapes come back from the driver,
 * not from TypeScript.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "sla.repository (integration)",
  () => {
    // Unique per run: the suite's files run in parallel against one
    // database, and insurer names are unique (migration 0020).
    const INSURER_NAME = `SLA Test Insurer ${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    let insurerId: string;
    let procedureId: string;
    let openClaimId: string;
    let settledClaimId: string;

    const SENT = new Date("2026-10-01T09:00:00.000Z");
    const DEADLINE = new Date("2026-10-01T10:00:00.000Z");
    /** Answered 90 minutes after a 60-minute deadline. */
    const ANSWERED = new Date("2026-10-01T10:30:00.000Z");

    beforeAll(async () => {
      const [insurer] = await db
        .insert(insurers)
        .values({ name: INSURER_NAME, type: "tpa" })
        .returning();
      const [procedure] = await db
        .insert(procedures)
        .values({ name: "SLA Test Procedure" })
        .returning();
      insurerId = insurer!.id;
      procedureId = procedure!.id;

      // An open claim whose latest event carries a deadline.
      const open = await claimsRepository.createClaim(
        { patientName: "SLA Open Patient", insurerId, procedureId },
        [],
      );
      openClaimId = open.id;
      // Opening a claim now writes its own DRAFT event, stamped at the
      // real clock. These fixtures back-date a chain instead, so clear
      // what the repository wrote before laying one down — otherwise
      // the auto event is the most recent and every "latest event"
      // assertion reads it.
      await db
        .delete(claimStatusEvents)
        .where(eq(claimStatusEvents.claimId, openClaimId));
      await db.insert(claimStatusEvents).values([
        { claimId: openClaimId, status: "DRAFT", createdAt: SENT },
        {
          claimId: openClaimId,
          status: "PRE_AUTH_SENT",
          slaDeadline: DEADLINE,
          createdAt: new Date(SENT.getTime() + 60_000),
        },
      ]);
      await db
        .update(claims)
        .set({ status: "PRE_AUTH_SENT" })
        .where(eq(claims.id, openClaimId));

      // A settled claim that was answered late — history, not a worklist
      // item, and the input to the turnaround report.
      const settled = await claimsRepository.createClaim(
        { patientName: "SLA Settled Patient", insurerId, procedureId },
        [],
      );
      settledClaimId = settled.id;
      await db
        .delete(claimStatusEvents)
        .where(eq(claimStatusEvents.claimId, settledClaimId));
      await db.insert(claimStatusEvents).values([
        {
          claimId: settledClaimId,
          status: "PRE_AUTH_SENT",
          slaDeadline: DEADLINE,
          createdAt: SENT,
        },
        {
          claimId: settledClaimId,
          status: "APPROVED",
          createdAt: ANSWERED,
        },
      ]);
      await db
        .update(claims)
        .set({ status: "SETTLED" })
        .where(eq(claims.id, settledClaimId));
    });

    afterAll(async () => {
      await db.delete(claims).where(eq(claims.insurerId, insurerId));
      await db.delete(insurers).where(eq(insurers.id, insurerId));
      await db.delete(procedures).where(eq(procedures.id, procedureId));
    });

    it("returns one row per open claim — its latest event, not every event", async () => {
      const rows = await repo.listOpenClaimClocks();
      const mine = rows.filter((r) => r.claimId === openClaimId);

      expect(mine).toHaveLength(1);
      expect(mine[0]!.status).toBe("PRE_AUTH_SENT");
      expect(mine[0]!.slaDeadline?.toISOString()).toBe(DEADLINE.toISOString());
      // Joined through, so the worklist reads without a query per row.
      expect(mine[0]!.reference).toMatch(/^CLM-/);
      expect(mine[0]!.insurerName).toBe(INSURER_NAME);
      expect(mine[0]!.patientName).toBe("SLA Open Patient");
    });

    it("leaves settled claims out of the live clock list", async () => {
      const rows = await repo.listOpenClaimClocks();
      expect(rows.some((r) => r.claimId === settledClaimId)).toBe(false);
    });

    it("measures how long the insurer took, and counts the breach", async () => {
      const rows = await repo.insurerTurnaround(
        new Date("2026-09-01T00:00:00.000Z"),
      );
      const mine = rows.find(
        (r) =>
          r.insurerName === INSURER_NAME && r.fromStatus === "PRE_AUTH_SENT",
      );

      expect(mine).toBeDefined();
      // 09:00 to 10:30 is an hour and a half.
      expect(mine!.avgHours).toBeCloseTo(1.5, 5);
      expect(mine!.breaches).toBe(1);
    });

    it("excludes a request still waiting rather than counting it as instant", async () => {
      const rows = await repo.insurerTurnaround(
        new Date("2026-09-01T00:00:00.000Z"),
      );
      const mine = rows.find(
        (r) =>
          r.insurerName === INSURER_NAME && r.fromStatus === "PRE_AUTH_SENT",
      );
      // Only the settled claim's answered request counts. The open
      // claim's unanswered one has no duration yet, and zero would
      // flatter the insurer it's still waiting on.
      expect(mine!.decisions).toBe(1);
    });

    it("reports nothing for a window with no events in it", async () => {
      const rows = await repo.insurerTurnaround(
        new Date("2030-01-01T00:00:00.000Z"),
      );
      expect(rows.some((r) => r.insurerName === INSURER_NAME)).toBe(false);
    });
  },
);
