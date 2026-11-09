import { and, eq } from "drizzle-orm";
import type { ClaimStatus } from "@claimflow/contracts";
import { db } from "./client.js";
import {
  checklistRules,
  claimPreauthFields,
  claimStatusEvents,
  claims,
  insurers,
  hospitalProfile,
  procedures,
  queries,
} from "./schema.js";

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

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
  // Running this twice used to mean two of every insurer, every
  // procedure and every claim, with no way back short of emptying the
  // database by hand.
  const reset = process.argv.includes("--reset");
  const [existing] = await db.select().from(hospitalProfile).limit(1);
  if (existing && !reset) {
    console.log(
      "Already seeded. Re-run with --reset to start from scratch.\n" +
        "That deletes every claim, rule, insurer and procedure this script owns.",
    );
    process.exit(0);
  }
  if (existing) {
    // Claims cascade to their events, documents, queries, deductions
    // and pre-auth fields; rules have to go before what they point at.
    await db.delete(claims);
    await db.delete(checklistRules);
    await db.delete(insurers);
    await db.delete(procedures);
    await db.delete(hospitalProfile);
    console.log("reset: cleared the previous seed");
  }

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

  /*
    The other two pairings. Only the gall bladder had rules before, so
    the knee replacement and the dengue claim froze an empty checklist
    and their files opened on "this claim has no checklist" — on a
    seed whose whole job is to show the checklist working.
  */
  await db.insert(checklistRules).values([
    ...[
      ["Pre-authorization form", true],
      ["Treating doctor's note", true],
      ["Photo ID proof", true],
      ["Policy / e-card copy", true],
      ["Investigation reports", true],
      ["Implant sticker / invoice", true],
      ["Previous treatment records", false],
    ].map(([documentType, required]) => ({
      insurerId: nivaBupa.id,
      procedureId: kneeReplacement.id,
      documentType: documentType as string,
      required: required as boolean,
    })),
    ...[
      ["Pre-authorization form", true],
      ["Treating doctor's note", true],
      ["Photo ID proof", true],
      ["Policy / e-card copy", true],
      ["Serial platelet count chart", true],
      ["Previous treatment records", false],
    ].map(([documentType, required]) => ({
      insurerId: vidal.id,
      procedureId: dengue.id,
      documentType: documentType as string,
      required: required as boolean,
    })),
  ]);

  /**
   * One claim, with the things a claim has: the checklist frozen from
   * the rules above (docs/adr/0001), and the chain of statuses it
   * moved through. Without the chain the stepper has nothing to draw
   * and turnaround has nothing to measure, which is how the first
   * version of this seed left all three.
   */
  async function openClaim(opts: {
    patientName: string;
    insurerId: string;
    procedureId: string;
    status: ClaimStatus;
    billedAmount?: string;
    sanctionedAmount?: string;
    admittedDaysAgo: number;
    chain: {
      status: ClaimStatus;
      daysAgo: number;
    }[];
  }) {
    const admittedAt = ago(opts.admittedDaysAgo);
    const snapshot = await db
      .select({
        documentType: checklistRules.documentType,
        required: checklistRules.required,
      })
      .from(checklistRules)
      .where(
        and(
          eq(checklistRules.insurerId, opts.insurerId),
          eq(checklistRules.procedureId, opts.procedureId),
        ),
      );

    const [row] = await db
      .insert(claims)
      .values({
        patientName: opts.patientName,
        insurerId: opts.insurerId,
        procedureId: opts.procedureId,
        status: opts.status,
        ...(opts.billedAmount ? { billedAmount: opts.billedAmount } : {}),
        ...(opts.sanctionedAmount
          ? { sanctionedAmount: opts.sanctionedAmount }
          : {}),
        admittedAt,
        createdAt: admittedAt,
        updatedAt: ago(opts.chain[opts.chain.length - 1]!.daysAgo),
        checklistSnapshot: snapshot,
      })
      .returning();
    const claim = must(row, `${opts.patientName}'s claim`);

    for (const step of opts.chain) {
      await db.insert(claimStatusEvents).values({
        claimId: claim.id,
        status: step.status,
        actorId: null,
        slaDeadline: null,
        createdAt: ago(step.daysAgo),
      });
    }
    return claim;
  }

  const gallBladderClaim = await openClaim({
    patientName: "Rajendra Pawar",
    insurerId: paramount.id,
    procedureId: gallBladder.id,
    status: "QUERY_RAISED",
    billedAmount: "185000",
    admittedDaysAgo: 5,
    chain: [
      { status: "DRAFT", daysAgo: 5 },
      { status: "PRE_AUTH_SENT", daysAgo: 4.8 },
      { status: "QUERY_RAISED", daysAgo: 2 },
    ],
  });

  const kneeClaim = await openClaim({
    patientName: "Sunita Deshmukh",
    insurerId: nivaBupa.id,
    procedureId: kneeReplacement.id,
    status: "PRE_AUTH_SENT",
    billedAmount: "320000",
    admittedDaysAgo: 1,
    chain: [
      { status: "DRAFT", daysAgo: 1 },
      { status: "PRE_AUTH_SENT", daysAgo: 0.9 },
    ],
  });

  const dengueClaim = await openClaim({
    patientName: "Imran Shaikh",
    insurerId: vidal.id,
    procedureId: dengue.id,
    status: "ENHANCEMENT_REQUESTED",
    billedAmount: "95000",
    sanctionedAmount: "72000",
    admittedDaysAgo: 2,
    chain: [
      { status: "DRAFT", daysAgo: 2 },
      { status: "PRE_AUTH_SENT", daysAgo: 1.9 },
      { status: "APPROVED", daysAgo: 1.5 },
      { status: "ENHANCEMENT_REQUESTED", daysAgo: 0.4 },
    ],
  });

  /*
    The knee replacement carries a filled form, because it is the one
    a pre-auth demo opens and "0 of 25 confirmed" on a claim already
    sent to an insurer is a contradiction. The costing lines sum to the
    total they declare — a pre-auth that does not is the first thing a
    TPA sends back.
  */
  await db.insert(claimPreauthFields).values(
    Object.entries({
      treatingDoctorName: "Dr. Rameshwar Joshi",
      treatingDoctorRegistrationNo: "MMC/2004/41208",
      illnessWithComplaints:
        "Severe bilateral knee pain, unable to climb stairs for 8 months",
      clinicalFindings:
        "Grade IV osteoarthritis, varus deformity, ROM 10-90 degrees",
      ailmentDurationDays: "240",
      firstConsultationDate: ago(34).toISOString().slice(0, 10),
      provisionalDiagnosis: "Primary osteoarthritis of knee",
      icd10Code: "M17.0",
      lineOfTreatment: "Surgical management",
      surgeryName: "Total knee replacement",
      admissionDate: ago(1).toISOString().slice(0, 10),
      admissionTime: "09:20",
      admissionType: "Planned",
      expectedStayDays: "5",
      roomType: "Single private room",
      roomRentPerDay: "14000",
      investigationCost: "38400",
      otCharges: "57600",
      professionalFees: "76800",
      medicinesConsumables: "77200",
      totalExpectedCost: "320000",
    }).map(([fieldKey, value]) => ({
      claimId: kneeClaim.id,
      fieldKey,
      value,
      confirmedAt: ago(0.95),
    })),
  );

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
