import { db } from "./client.js";
import {
  checklistRules,
  claims,
  insurers,
  organizations,
  procedures,
  queries,
} from "./schema.js";

/**
 * Local/dev seed: the three sample claims from the product brief, for the
 * pilot tenant (Company A, Nashik). Run with `tsx src/db/seed.ts`.
 *
 * Org members (users) are intentionally NOT seeded here — they're created
 * through the real sign-up/invite flow once it exists, not faked in, so
 * local auth behaves the same as production.
 */

/** A row we just inserted ourselves is never actually absent — asserts that for TS. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined)
    throw new Error(`seed: expected ${what} to exist after insert`);
  return value;
}

async function seed() {
  const [orgRow] = await db
    .insert(organizations)
    .values({
      name: "Company A — Nashik Multispecialty",
      slug: "company-a-nashik",
      subscriptionStatus: "active",
      plan: "pilot",
    })
    .returning();
  const org = must(orgRow, "organization");

  const [companyBRow, companyCRow, companyDRow] = await db
    .insert(insurers)
    .values([
      { name: "Company B", type: "tpa" },
      { name: "Company C", type: "insurer" },
      { name: "Company D", type: "tpa" },
    ])
    .returning();
  const companyB = must(companyBRow, "Company B");
  const companyC = must(companyCRow, "Company C");
  const companyD = must(companyDRow, "Company D");

  const [gallBladderRow, kneeReplacementRow, dengueRow] = await db
    .insert(procedures)
    .values([
      { name: "Gall bladder removal" },
      { name: "Total knee replacement" },
      { name: "Dengue with low platelets" },
    ])
    .returning();
  const gallBladder = must(gallBladderRow, "Gall bladder removal");
  const kneeReplacement = must(kneeReplacementRow, "Total knee replacement");
  const dengue = must(dengueRow, "Dengue with low platelets");

  await db.insert(checklistRules).values([
    {
      organizationId: org.id,
      insurerId: companyB.id,
      procedureId: gallBladder.id,
      documentType: "Pre-authorization form",
      required: true,
    },
    {
      organizationId: org.id,
      insurerId: companyB.id,
      procedureId: gallBladder.id,
      documentType: "Treating doctor's note",
      required: true,
    },
    {
      organizationId: org.id,
      insurerId: companyB.id,
      procedureId: gallBladder.id,
      documentType: "Ultrasound report (abdomen)",
      required: true,
    },
    {
      organizationId: org.id,
      insurerId: companyB.id,
      procedureId: gallBladder.id,
      documentType: "Photo ID proof",
      required: true,
    },
    {
      organizationId: org.id,
      insurerId: companyB.id,
      procedureId: gallBladder.id,
      documentType: "Policy / e-card copy",
      required: true,
    },
    {
      organizationId: org.id,
      insurerId: companyB.id,
      procedureId: gallBladder.id,
      documentType: "Previous treatment records",
      required: false,
    },
  ]);

  const [clm3381Row] = await db
    .insert(claims)
    .values({
      organizationId: org.id,
      patientName: "Rajendra Pawar",
      insurerId: companyB.id,
      procedureId: gallBladder.id,
      status: "QUERY_RAISED",
      billedAmount: "185000",
      admittedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      // Normally frozen onto the claim by claims.service.createClaim at
      // open time (docs/adr/0001) — inlined here since this seed inserts
      // the row directly rather than going through that service.
      checklistSnapshot: [
        { documentType: "Pre-authorization form", required: true },
        { documentType: "Treating doctor's note", required: true },
        { documentType: "Ultrasound report (abdomen)", required: true },
        { documentType: "Photo ID proof", required: true },
        { documentType: "Policy / e-card copy", required: true },
        { documentType: "Previous treatment records", required: false },
      ],
    })
    .returning();
  const clm3381 = must(clm3381Row, "CLM-3381");

  await db.insert(claims).values([
    {
      organizationId: org.id,
      patientName: "Sunita Deshmukh",
      insurerId: companyC.id,
      procedureId: kneeReplacement.id,
      status: "PRE_AUTH_SENT",
      billedAmount: "320000",
      admittedAt: new Date(Date.now() - 60 * 60 * 1000),
    },
    {
      organizationId: org.id,
      patientName: "Imran Shaikh",
      insurerId: companyD.id,
      procedureId: dengue.id,
      status: "ENHANCEMENT_REQUESTED",
      billedAmount: "95000",
      admittedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    },
  ]);

  await db.insert(queries).values({
    claimId: clm3381.id,
    tpaRawEmail:
      "Dear Team,\n\nWith reference to the pre-authorization request for patient Rajendra Pawar (Claim Ref: CLM-3381) for laparoscopic cholecystectomy, we note that the ultrasound report confirming gallstone diagnosis has not been enclosed with the submitted documents.\n\nKindly share the ultrasound report along with the radiologist's impression at the earliest to enable processing of this request. This query must be resolved within 48 hours of this communication, failing which the request will be closed.\n\nRegards,\nClaims Team, Company B TPA",
    aiSummary:
      "Company B TPA needs the ultrasound report (with radiologist's impression) for Rajendra Pawar's gallbladder claim before they can process pre-authorization. Reply within 48 hours of the email, or the request closes automatically.",
    requestedItems: [
      "Ultrasound report (abdomen), with radiologist's impression",
    ],
    deadline: new Date(Date.now() - 6 * 60 * 60 * 1000),
  });

  console.log(`Seeded organization ${org.slug} with 3 claims.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
