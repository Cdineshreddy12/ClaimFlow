import { config } from "dotenv";
config({ path: "../../.env" });

import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { claims, insurers, procedures } from "../../db/schema.js";
import * as claimsRepository from "../claims/claims.repository.js";
import * as repo from "./reports.repository.js";

/**
 * A closed period, against real SQL: opened/settled/settled-value/TAT
 * are each their own FILTER over one claims table, so the case that
 * actually breaks a naive WHERE-scoped query — a claim opened outside
 * the window but settled inside it, or vice versa — is the thing worth
 * proving rather than assuming.
 *
 * The window is pinned 13 months behind whenever this runs, not to a
 * fixed calendar date: this suite's files share one real database and
 * run in parallel, and every other test here creates claims with
 * `createdAt` defaulting to "now" — a window that far back can't
 * collide with any of them.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "reports.repository.periodClaimsSummary (integration)",
  () => {
    const INSURER_NAME = `Report Test Insurer ${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    let insurerId: string;
    let procedureId: string;

    const now = new Date();
    const from = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 13, 1),
    );
    const to = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1),
    );
    const beforeWindow = new Date(from.getTime() - 5 * 24 * 3_600_000);

    async function claimAt(
      patientName: string,
      createdAt: Date,
      settlement?: { settledOn: Date; settledAmount: number },
    ): Promise<string> {
      const claim = await claimsRepository.createClaim(
        { patientName, insurerId, procedureId },
        [],
      );
      await db
        .update(claims)
        .set({
          createdAt,
          ...(settlement
            ? {
                status: "SETTLED",
                settledOn: settlement.settledOn.toISOString().slice(0, 10),
                settledAmount: settlement.settledAmount.toString(),
              }
            : {}),
        })
        .where(eq(claims.id, claim.id));
      return claim.id;
    }

    beforeAll(async () => {
      /*
        `periodClaimsSummary` sums the whole hospital over a window —
        there is no insurer to scope it to, which is the point of the
        report. So unlike every other test here, this one cannot make
        itself independent of rows it did not create: a back-dated
        "Report Patient" left in the shared database by a run that was
        interrupted before its cleanup lands in this same window and
        quietly turns "opened: 3" into "opened: 5".

        Sweeping the marker first makes the suite self-healing rather
        than permanently poisoned by one cancelled run.
      */
      await db
        .delete(claims)
        .where(like(claims.patientName, "Report Patient%"));

      const [insurer] = await db
        .insert(insurers)
        .values({ name: INSURER_NAME, type: "tpa" })
        .returning();
      const [procedure] = await db
        .insert(procedures)
        .values({ name: "Report Test Procedure" })
        .returning();
      insurerId = insurer!.id;
      procedureId = procedure!.id;

      // Opened and settled within the window: counts everywhere, TAT 15 days.
      await claimAt(
        "Report Patient A",
        new Date(from.getTime() + 4 * 24 * 3_600_000),
        {
          settledOn: new Date(from.getTime() + 19 * 24 * 3_600_000),
          settledAmount: 100_000,
        },
      );
      // Opened and settled within the window: TAT 15 days.
      await claimAt(
        "Report Patient B",
        new Date(from.getTime() + 9 * 24 * 3_600_000),
        {
          settledOn: new Date(from.getTime() + 24 * 24 * 3_600_000),
          settledAmount: 50_000,
        },
      );
      // Opened within the window, still in flight: counts as opened only.
      await claimAt(
        "Report Patient C",
        new Date(from.getTime() + 14 * 24 * 3_600_000),
      );
      // Opened BEFORE the window but settled INSIDE it: the case a
      // single shared WHERE would get wrong — counts as settled, not opened.
      await claimAt("Report Patient D", beforeWindow, {
        settledOn: new Date(from.getTime() + 2 * 24 * 3_600_000),
        settledAmount: 20_000,
      });
      // Opened AFTER the window entirely: must not appear at all.
      await claimAt("Report Patient E", to);
    });

    afterAll(async () => {
      await db.delete(claims).where(eq(claims.insurerId, insurerId));
      await db.delete(insurers).where(eq(insurers.id, insurerId));
      await db.delete(procedures).where(eq(procedures.id, procedureId));
    });

    it("counts opened by creation date and settled by settlement date, independently", async () => {
      const summary = await repo.periodClaimsSummary(from, to);

      expect(summary.opened).toBe(3); // A, B, C — not D (opened earlier) or E (opened later)
      expect(summary.settled).toBe(3); // A, B, D — not C (never settled)
      expect(summary.settledValue).toBe(170_000);
    });

    it("averages turnaround end to end, over claims settled in the window", async () => {
      const summary = await repo.periodClaimsSummary(from, to);

      // A: 15 days, B: 15 days, D: 7 days (opened 5 days before the
      // window, settled 2 days in) → (15 + 15 + 7) / 3
      expect(summary.avgTatDays).toBeCloseTo(37 / 3, 1);
    });

    it("reports no turnaround when nothing settled in the window", async () => {
      const empty = new Date(Date.UTC(1999, 0, 1));
      const summary = await repo.periodClaimsSummary(
        empty,
        new Date(Date.UTC(1999, 1, 1)),
      );

      expect(summary.settled).toBe(0);
      expect(summary.avgTatDays).toBeNull();
    });
  },
);
