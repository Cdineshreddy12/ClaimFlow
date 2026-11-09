import { db } from "./client.js";
import {
  checklistRules,
  claims,
  insurers,
  hospitalProfile,
  procedures,
  queries,
} from "./schema.js";

/**
 * Local/dev seed: the three sample claims from the product brief. Run
 * with `tsx src/db/seed.ts`.
 *
 * Members (users) are intentionally NOT seeded here — they're created
 * through the real sign-up/invite flow, not faked in, so local auth
 * behaves the same as production.
 */

/** A row we just inserted ourselves is never actually absent — asserts that for TS. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined)
    throw new Error(`seed: expected ${what} to exist after insert`);
  return value;
}

async function seed() {
  const [hospitalRow] = await db
    .insert(hospitalProfile)
    .values({ name: "City General Hospital" })
    .returning();
  must(hospitalRow, "hospital profile");

  const [paramountRow, nivaBupaRow, vidalRow] = await db
    .insert(insurers)
    .values([
      // Real payers an Indian cashless desk actually deals with. The
      // brief anonymised them as Company B/C/D; on a screen beside
      // Star Health and Ayushman Bharat that reads as unfinished work
      // rather than discretion.
      { name: "Paramount Health TPA", type: "tpa" },
      { name: "Niva Bupa Health Insurance", type: "insurer" },
      { name: "Vidal Health TPA", type: "tpa" },
    ])
    .returning();
  const paramount = must(paramountRow, "Paramount Health TPA");
  const nivaBupa = must(nivaBupaRow, "Niva Bupa Health Insurance");
  const vidal = must(vidalRow, "Vidal Health TPA");

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
      insurerId: paramount.id,
      procedureId: gallBladder.id,
      documentType: "Pre-authorization form",
      required: true,
    },
    {
      insurerId: paramount.id,
      procedureId: gallBladder.id,
      documentType: "Treating doctor's note",
      required: true,
    },
    {
      insurerId: paramount.id,
      procedureId: gallBladder.id,
      documentType: "Ultrasound report (abdomen)",
      required: true,
    },
    {
      insurerId: paramount.id,
      procedureId: gallBladder.id,
      documentType: "Photo ID proof",
      required: true,
    },
    {
      insurerId: paramount.id,
      procedureId: gallBladder.id,
      documentType: "Policy / e-card copy",
      required: true,
    },
    {
      insurerId: paramount.id,
      procedureId: gallBladder.id,
      documentType: "Previous treatment records",
      required: false,
    },
  ]);

  const [gallBladderClaimRow] = await db
    .insert(claims)
    .values({
      patientName: "Rajendra Pawar",
      insurerId: paramount.id,
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
  const gallBladderClaim = must(gallBladderClaimRow, "Rajendra Pawar's claim");

  const [, dengueClaimRow] = await db
    .insert(claims)
    .values([
      {
        patientName: "Sunita Deshmukh",
        insurerId: nivaBupa.id,
        procedureId: kneeReplacement.id,
        status: "PRE_AUTH_SENT",
        billedAmount: "320000",
        admittedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
      {
        patientName: "Imran Shaikh",
        insurerId: vidal.id,
        procedureId: dengue.id,
        status: "ENHANCEMENT_REQUESTED",
        billedAmount: "95000",
        admittedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    ])
    .returning();
  const dengueClaim = must(dengueClaimRow, "Imran Shaikh's claim");

  await db.insert(queries).values([
    {
      claimId: gallBladderClaim.id,
      tpaRawEmail:
        "Dear Team,\n\nWith reference to the pre-authorization request for patient Rajendra Pawar (Claim Ref: CLM-0001) for laparoscopic cholecystectomy, we note that the ultrasound report confirming gallstone diagnosis has not been enclosed with the submitted documents.\n\nKindly share the ultrasound report along with the radiologist's impression at the earliest to enable processing of this request. This query must be resolved within 48 hours of this communication, failing which the request will be closed.\n\nRegards,\nClaims Team, Paramount Health TPA",
      aiSummary:
        "Paramount Health TPA needs the ultrasound report (with radiologist's impression) for Rajendra Pawar's gallbladder claim before they can process pre-authorization. Reply within 48 hours of the email, or the request closes automatically.",
      requestedItems: [
        "Ultrasound report (abdomen), with radiologist's impression",
      ],
      deadline: new Date(Date.now() - 6 * 60 * 60 * 1000),
    },
    {
      claimId: dengueClaim.id,
      tpaRawEmail:
        "Dear Team,\n\nWith reference to the enhancement request for patient Imran Shaikh (Claim Ref: CLM-0003) for dengue with low platelets, we require an updated CBC report showing the platelet count trend over the last 24 hours before we can process the enhanced sanction.\n\nKindly share this within 24 hours of this communication.\n\nRegards,\nClaims Team, Vidal Health TPA",
      aiSummary:
        "Vidal Health TPA needs an updated CBC/platelet trend (last 24h) before approving the enhancement for Imran Shaikh. Reply within 24 hours.",
      requestedItems: [
        "Updated CBC report with platelet count trend (last 24h)",
      ],
      deadline: new Date(Date.now() + 18 * 60 * 60 * 1000),
    },
  ]);

  console.log("Seeded City General Hospital with 3 claims.");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
