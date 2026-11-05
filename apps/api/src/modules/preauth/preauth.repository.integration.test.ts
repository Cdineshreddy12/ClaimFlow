import { config } from "dotenv";
config({ path: "../../.env" });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { claims, insurers, procedures } from "../../db/schema.js";
import * as claimsRepository from "../claims/claims.repository.js";
import * as preauthRepository from "./preauth.repository.js";

describe.skipIf(!process.env.DATABASE_URL)(
  "preauth.repository (integration)",
  () => {
    // Unique per run: the suite's files run in parallel against one
    // database, and insurer names are unique (migration 0020).
    const INSURER_NAME = `Preauth Test Insurer ${Date.now()}-${Math.random()
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
        .values({ name: "Preauth Test Procedure" })
        .returning();
      insurerId = insurer!.id;
      procedureId = procedure!.id;

      const claim = await claimsRepository.createClaim(
        { patientName: "Preauth Test Patient", insurerId, procedureId },
        [{ documentType: "Treating doctor's note", required: true }],
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

    it("stores a suggestion without filling in the human value", async () => {
      await preauthRepository.saveSuggestions(
        claimId,
        [
          {
            fieldKey: "provisionalDiagnosis",
            aiValue: "Acute cholecystitis",
            confidence: 0.91,
            sourceSnippet: "diagnosed with acute cholecystitis",
            sourceDocumentId: null,
            extractedBy: "claude",
          },
        ],
        new Date(),
      );

      const rows = await preauthRepository.listForClaim(claimId);
      const row = rows?.find((r) => r.fieldKey === "provisionalDiagnosis");
      expect(row?.aiValue).toBe("Acute cholecystitis");
      expect(row?.confidence).toBe("0.910");
      // The whole point of adr 0005: a suggestion is not a value.
      expect(row?.value).toBeNull();
      expect(row?.confirmedAt).toBeNull();
    });

    it("re-running the extractor replaces a suggestion rather than stacking one up", async () => {
      await preauthRepository.saveSuggestions(
        claimId,
        [
          {
            fieldKey: "icd10Code",
            aiValue: "K80.0",
            confidence: 0.6,
            sourceSnippet: "first read",
            sourceDocumentId: null,
            extractedBy: "claude",
          },
        ],
        new Date(),
      );
      await preauthRepository.saveSuggestions(
        claimId,
        [
          {
            fieldKey: "icd10Code",
            aiValue: "K81.0",
            confidence: 0.95,
            sourceSnippet: "second read, clearer scan",
            sourceDocumentId: null,
            extractedBy: "claude",
          },
        ],
        new Date(),
      );

      const rows = await preauthRepository.listForClaim(claimId);
      const matching = rows?.filter((r) => r.fieldKey === "icd10Code") ?? [];
      expect(matching).toHaveLength(1);
      expect(matching[0]?.aiValue).toBe("K81.0");
    });

    it("never lets a re-run overwrite a value a human confirmed", async () => {
      // The guarantee the whole confirm flow rests on. A desk executive
      // who corrected a figure must not find the model's answer back in
      // its place after someone uploads another page.
      await preauthRepository.saveSuggestions(
        claimId,
        [
          {
            fieldKey: "totalExpectedCost",
            aiValue: "185000.00",
            confidence: 0.8,
            sourceSnippet: "estimate sheet",
            sourceDocumentId: null,
            extractedBy: "claude",
          },
        ],
        new Date(),
      );
      await preauthRepository.confirm(
        claimId,
        "totalExpectedCost",
        "192500.00",
        null,
      );

      await preauthRepository.saveSuggestions(
        claimId,
        [
          {
            fieldKey: "totalExpectedCost",
            aiValue: "178000.00",
            confidence: 0.99,
            sourceSnippet: "a different estimate sheet",
            sourceDocumentId: null,
            extractedBy: "claude",
          },
        ],
        new Date(),
      );

      const rows = await preauthRepository.listForClaim(claimId);
      const row = rows?.find((r) => r.fieldKey === "totalExpectedCost");
      expect(row?.value).toBe("192500.00");
      expect(row?.confirmedAt).not.toBeNull();
      // The new suggestion is still recorded, just not promoted.
      expect(row?.aiValue).toBe("178000.00");
    });

    it("confirms a field that was never suggested", async () => {
      // Half the form will never be in the documents — a desk types it.
      const row = await preauthRepository.confirm(
        claimId,
        "roomType",
        "Twin sharing",
        null,
      );
      expect(row?.value).toBe("Twin sharing");
      expect(row?.aiValue).toBeNull();
      expect(row?.confirmedAt).not.toBeNull();
    });

    it("clearing a value leaves the suggestion in place", async () => {
      await preauthRepository.saveSuggestions(
        claimId,
        [
          {
            fieldKey: "roomRentPerDay",
            aiValue: "4500.00",
            confidence: 0.7,
            sourceSnippet: "tariff sheet",
            sourceDocumentId: null,
            extractedBy: "claude",
          },
        ],
        new Date(),
      );
      await preauthRepository.confirm(
        claimId,
        "roomRentPerDay",
        "5000.00",
        null,
      );

      const cleared = await preauthRepository.clearValue(
        claimId,
        "roomRentPerDay",
      );
      expect(cleared?.value).toBeNull();
      expect(cleared?.confirmedAt).toBeNull();
      // Back to needing a decision, not gone.
      expect(cleared?.aiValue).toBe("4500.00");
    });

    // The cross-organization tests that sat here went with
    // multi-tenancy — there is no other organization to be refused
    // from. What still holds is that an unknown claim id yields
    // nothing rather than throwing, so that is what's pinned now.
    it("refuses every read and write against a claim that doesn't exist", async () => {
      const missing = "00000000-0000-0000-0000-000000000000";
      expect(await preauthRepository.listForClaim(missing)).toBeUndefined();
      expect(
        await preauthRepository.confirm(missing, "icd10Code", "K81.0", null),
      ).toBeUndefined();
      expect(
        await preauthRepository.clearValue(missing, "icd10Code"),
      ).toBeUndefined();
    });
  },
);
