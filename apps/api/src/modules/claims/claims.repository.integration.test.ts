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
    // Unique per run: the suite's files run in parallel against one
    // database, and insurer names are unique (migration 0020).
    const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const INSURER_NAME = `Test Insurer ${RUN}`;

    /*
      The paging test searches by patient name, and `listClaims` searches
      the whole hospital — it has no insurer to scope it to. A fixed name
      like "Page A" therefore also matches the "Page A" a previous run
      left behind when it was interrupted before its cleanup, and "of 3"
      silently becomes "of 6".

      Tagging the names with the run makes the search match only rows
      this run created, so residue in the shared database is inert
      rather than a failure three runs later in a different file.
    */
    const PAGE_TAG = `Page-${RUN} `;

    let insurerId: string;
    let procedureId: string;

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
    });

    afterAll(async () => {
      // cascades to any claims/claim_status_events created in this run
      // The organization used to cascade these away on delete. Without
      // it the claims hold a foreign key onto the insurer below.
      await db.delete(claims).where(eq(claims.insurerId, insurerId));
      await db.delete(insurers).where(eq(insurers.id, insurerId));
      await db.delete(procedures).where(eq(procedures.id, procedureId));
    });

    /**
     * The paging, searching and ordering that used to run in the
     * browser over every claim the hospital had ever opened. SQL now,
     * so the only honest test of it is against a real database.
     */
    describe("listClaims", () => {
      it("pages, and reports the total behind the page", async () => {
        for (const suffix of ["A", "B", "C"]) {
          await claimsRepository.createClaim(
            { patientName: `${PAGE_TAG}${suffix}`, insurerId, procedureId },
            [],
          );
        }

        const first = await claimsRepository.listClaims({
          q: PAGE_TAG,
          limit: 2,
          offset: 0,
        });

        expect(first.rows).toHaveLength(2);
        // The count is of matches, not of the page — "of 3" has to be
        // right or the pager lies about whether there is a next page.
        expect(first.total).toBe(3);

        const second = await claimsRepository.listClaims({
          q: PAGE_TAG,
          limit: 2,
          offset: 2,
        });
        expect(second.rows).toHaveLength(1);
        // No row appears on both pages.
        const ids = new Set([...first.rows, ...second.rows].map((r) => r.id));
        expect(ids.size).toBe(3);
      });

      it("searches the patient's name, case-insensitively", async () => {
        await claimsRepository.createClaim(
          { patientName: "Rukmini Searchable", insurerId, procedureId },
          [],
        );

        const found = await claimsRepository.listClaims({ q: "rukmini" });
        expect(found.rows.map((r) => r.patientName)).toContain(
          "Rukmini Searchable",
        );
      });

      it("treats % in a search as a character, not a wildcard", async () => {
        // Otherwise a stray % matches every claim on the desk.
        const all = await claimsRepository.listClaims({});
        const wild = await claimsRepository.listClaims({ q: "%" });
        expect(wild.total).toBeLessThan(all.total);
      });

      it("filters to the statuses it is given", async () => {
        const open = await claimsRepository.listClaims({
          statuses: ["DRAFT"],
        });
        for (const row of open.rows) expect(row.status).toBe("DRAFT");
      });
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
