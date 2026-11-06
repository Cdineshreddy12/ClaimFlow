import { config } from "dotenv";
config({ path: "../../.env" });

import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { claims, insurers, procedures } from "../../db/schema.js";
import * as repo from "./procedures.repository.js";

describe.skipIf(!process.env.DATABASE_URL)(
  "procedures.repository (integration)",
  () => {
    // Unique per run: the suite's files run in parallel against one
    // database, and these assertions count rows.
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const created: string[] = [];
    const insurerIds: string[] = [];

    async function makeProcedure(name: string) {
      const row = await repo.create({ name: `${name} ${stamp}`, code: null });
      created.push(row!.id);
      return row!;
    }

    afterAll(async () => {
      if (created.length) {
        await db.delete(claims).where(inArray(claims.procedureId, created));
        await db.delete(procedures).where(inArray(procedures.id, created));
      }
      if (insurerIds.length) {
        await db.delete(insurers).where(inArray(insurers.id, insurerIds));
      }
    });

    it("hides a retired procedure from the default list", async () => {
      // The default list is what every picker reads. A procedure the
      // hospital has stopped doing should stop being offered on new
      // claims the moment it is retired.
      const row = await makeProcedure("Retired Proc");
      await repo.setActive(row.id, false);

      const live = await repo.list();
      expect(live.map((p) => p.id)).not.toContain(row.id);
    });

    it("keeps it on the admin list, flagged", async () => {
      // Retiring has to be visible and undoable — a row that vanished
      // from every list could never be put back.
      const row = await makeProcedure("Admin Visible");
      await repo.setActive(row.id, false);

      const all = await repo.list(true);
      const found = all.find((p) => p.id === row.id);
      expect(found?.isActive).toBe(false);
    });

    it("puts it back", async () => {
      const row = await makeProcedure("Reinstated");
      await repo.setActive(row.id, false);
      await repo.setActive(row.id, true);

      const live = await repo.list();
      expect(live.map((p) => p.id)).toContain(row.id);
    });

    it("leaves the claims that used it alone", async () => {
      // The whole reason retiring exists: those claims were opened
      // under this name and a checklist snapshot has to stay
      // answerable, so the row itself must survive untouched
      // (docs/adr/0001).
      const [insurer] = await db
        .insert(insurers)
        .values({ name: `Test Insurer ${stamp}`, type: "tpa" })
        .returning();
      insurerIds.push(insurer!.id);
      const row = await makeProcedure("Still Referenced");

      const [claim] = await db
        .insert(claims)
        .values({
          reference: `CLM-T${stamp.slice(-6)}`,
          patientName: "Test Patient",
          insurerId: insurer!.id,
          procedureId: row.id,
          status: "DRAFT",
          checklistSnapshot: [],
        })
        .returning();

      await repo.setActive(row.id, false);

      const [after] = await db
        .select()
        .from(claims)
        .where(eq(claims.id, claim!.id));
      expect(after?.procedureId).toBe(row.id);

      // And the usage count still blocks a delete, so retiring is not
      // a back door to removing a procedure claims depend on.
      const usage = await repo.usage(row.id);
      expect(usage.claims).toBe(1);
    });

    it("still counts claims and rules on a retired row", async () => {
      // The admin list shows the counts beside each row; a retired one
      // showing "0 claims" would invite deleting it.
      const row = await makeProcedure("Counted");
      await repo.setActive(row.id, false);

      const all = await repo.list(true);
      expect(all.find((p) => p.id === row.id)).toMatchObject({
        claims: 0,
        rules: 0,
      });
    });
  },
);
