import { config } from "dotenv";
config({ path: "../../.env" });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { claims, insurers, procedures } from "../../db/schema.js";
import * as claimsRepository from "../claims/claims.repository.js";
import * as queriesRepository from "./queries.repository.js";

describe.skipIf(!process.env.DATABASE_URL)(
  "queries.repository (integration)",
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
        { patientName: "Query Test Patient", insurerId, procedureId },
        [],
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

    it("creates a query, lists it for the claim, and reads it back by id", async () => {
      const created = await queriesRepository.create(claimId, {
        tpaRawEmail: "Dear Team, the ultrasound report is missing...",
        requestedItems: ["Ultrasound report (abdomen)"],
      });
      expect(created?.aiSummary).toBeNull();

      const listed = await queriesRepository.listForClaim(claimId);
      expect(listed?.some((q) => q.id === created!.id)).toBe(true);

      const fetched = await queriesRepository.getById(created!.id);
      expect(fetched?.tpaRawEmail).toContain("ultrasound report is missing");
    });

    // The cross-organization tests that sat here went with
    // multi-tenancy — there is no other organization to be refused
    // from. What still holds is that an unknown claim id yields
    // nothing rather than throwing, so that is what's pinned now.
    it("returns undefined for a query that doesn't exist", async () => {
      const missing = await queriesRepository.getById(
        "00000000-0000-0000-0000-000000000000",
      );
      expect(missing).toBeUndefined();
    });

    it("markReplied stamps replySentAt, and listInbox respects the open/replied/all filter", async () => {
      const openQuery = await queriesRepository.create(claimId, {
        tpaRawEmail: "still open",
        requestedItems: [],
      });
      const toBeReplied = await queriesRepository.create(claimId, {
        tpaRawEmail: "will be replied",
        requestedItems: [],
      });
      await queriesRepository.markReplied(toBeReplied!.id);

      const open = await queriesRepository.listInbox({
        status: "open",
      });
      expect(open.some((q) => q.id === openQuery!.id)).toBe(true);
      expect(open.some((q) => q.id === toBeReplied!.id)).toBe(false);

      const replied = await queriesRepository.listInbox({
        status: "replied",
      });
      expect(replied.some((q) => q.id === toBeReplied!.id)).toBe(true);
      expect(replied.some((q) => q.id === openQuery!.id)).toBe(false);

      const all = await queriesRepository.listInbox({
        status: "all",
      });
      expect(all.some((q) => q.id === openQuery!.id)).toBe(true);
      expect(all.some((q) => q.id === toBeReplied!.id)).toBe(true);
    });

    it("update patches only the fields given", async () => {
      const created = await queriesRepository.create(claimId, {
        tpaRawEmail: "...",
        requestedItems: ["A"],
        aiSummary: "original summary",
      });

      const updated = await queriesRepository.update(created!.id, {
        aiSummary: "corrected summary",
      });
      expect(updated?.aiSummary).toBe("corrected summary");
      expect(updated?.requestedItems).toEqual(["A"]);
    });

    /**
     * The deadline is the one summariser output that lands in a live
     * column rather than a suggestion one, so the confirm step on it is
     * the thing worth pinning against real Postgres — docs/adr/0005.
     */
    describe("confirmDeadline", () => {
      const DERIVED = new Date("2026-11-06T09:15:00.000Z");

      async function summarisedQuery() {
        return queriesRepository.create(claimId, {
          tpaRawEmail: "Please revert within 48 hours.",
          requestedItems: [],
          deadline: DERIVED,
          summarisedBy: "claude",
          deadlineInferred: true,
        });
      }

      it("leaves a summariser's deadline unconfirmed on the way in", async () => {
        const created = await summarisedQuery();
        expect(created?.deadline).toEqual(DERIVED);
        expect(created?.deadlineConfirmedAt).toBeNull();
        expect(created?.deadlineConfirmedBy).toBeNull();
      });

      it("stamps the date without touching it when no override is given", async () => {
        const created = await summarisedQuery();

        const confirmed = await queriesRepository.confirmDeadline(
          created!.id,
          undefined,
          null,
        );
        expect(confirmed?.deadline).toEqual(DERIVED);
        expect(confirmed?.deadlineConfirmedAt).toBeInstanceOf(Date);
        // Still how the value was arrived at. Confirmation is the other
        // axis, and overwriting the provenance would lose the only
        // record that a model read it out of "within 48 hours".
        expect(confirmed?.deadlineInferred).toBe(true);
      });

      it("takes an override, and stops calling it inferred", async () => {
        const created = await summarisedQuery();
        const corrected = new Date("2026-11-07T12:30:00.000Z");

        const confirmed = await queriesRepository.confirmDeadline(
          created!.id,
          corrected,
          null,
        );
        expect(confirmed?.deadline).toEqual(corrected);
        expect(confirmed?.deadlineInferred).toBe(false);
      });

      it("clears a deadline the email never actually set", async () => {
        const created = await summarisedQuery();

        const confirmed = await queriesRepository.confirmDeadline(
          created!.id,
          null,
          null,
        );
        expect(confirmed?.deadline).toBeNull();
        // Confirmed, not merely blank: the desk read the email and
        // there is no deadline, which is a different fact from nobody
        // having looked.
        expect(confirmed?.deadlineConfirmedAt).toBeInstanceOf(Date);
      });

      it("returns undefined for a query that doesn't exist", async () => {
        const missing = await queriesRepository.confirmDeadline(
          "00000000-0000-0000-0000-000000000000",
          null,
          null,
        );
        expect(missing).toBeUndefined();
      });

      it("counts a hand-typed deadline as confirmed by the edit that set it", async () => {
        const created = await queriesRepository.create(claimId, {
          tpaRawEmail: "...",
          requestedItems: [],
        });

        const typed = new Date("2026-11-09T06:00:00.000Z");
        const updated = await queriesRepository.update(created!.id, {
          deadline: typed,
        });
        expect(updated?.deadline).toEqual(typed);
        expect(updated?.deadlineConfirmedAt).toBeInstanceOf(Date);
      });
    });
  },
);
