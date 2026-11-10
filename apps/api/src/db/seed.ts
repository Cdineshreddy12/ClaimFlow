import { and, eq } from "drizzle-orm";
import { type ClaimStatus, slaDeadlineFor } from "@claimflow/contracts";
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
 * A form records the hospital's own clock, so these are IST — the same
 * reason preauth.service.ts stamps `+05:30` when it reads them back.
 * `toISOString()` would write the UTC date, which on anything admitted
 * after half past six in the evening is yesterday.
 */
const IST = "en-CA" as const;
const istDate = (d: Date) =>
  d.toLocaleDateString(IST, { timeZone: "Asia/Kolkata" });
const istTime = (d: Date) =>
  d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });

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

  // A named hospital, not a placeholder — the brief sized this against a
  // 180-bed multispecialty hospital in Nashik, so the seed is one rather
  // than leaving every profile field blank behind a generic name. None of
  // this is a real entity's identifiers; the formats are real (ROHINI,
  // GSTIN, PAN), the numbers inside them are invented.
  const [hospitalRow] = await db
    .insert(hospitalProfile)
    .values({
      name: "Godavari Multispecialty Hospital",
      legalEntityName: "Godavari Healthcare Private Limited",
      hospitalType: "Multispecialty",
      ownershipType: "Private",
      bedCount: 180,
      rohiniId: "MH0234119870",
      registrationNumber: "MH/NSK/HOSP/2014/00231",
      pan: "AABCG4521H",
      gstin: "27AABCG4521H1Z5",
      nabhStatus: "Accredited",
      addressLine1: "12, College Road",
      addressLine2: "Near Shivaji Stadium",
      city: "Nashik",
      state: "Maharashtra",
      pincode: "422005",
      phone: "0253-2576410",
      email: "desk@godavarimultispecialty.in",
      website: "https://godavarimultispecialty.in",
      deskContactName: "Anjali Kulkarni",
      deskContactPhone: "+91 98230 11456",
      deskContactEmail: "insurancedesk@godavarimultispecialty.in",
      brandAccentColor: "#0E7C86",
      tagline: "Multispecialty care, Nashik",
      onboardingCompletedAt: new Date(),
    })
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
      const at = ago(step.daysAgo);
      await db.insert(claimStatusEvents).values({
        claimId: claim.id,
        status: step.status,
        actorId: null,
        // Stamped from the same table the server stamps from, rather
        // than left null. Turnaround counts a breach as `answered_at >
        // sla_deadline`, so an event with no deadline can never be one
        // — seeded claims reported perfect compliance because the
        // column was empty, not because anybody met the hour.
        slaDeadline: slaDeadlineFor(step.status, at),
        createdAt: at,
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

  /**
   * A form with the previous patient's surgery still on it.
   *
   * The pre-submission check (docs/adr/0015) has a rule for a surgery
   * named on a non-surgical admission, and nothing in the seed ever
   * tripped it — so the one finding a reviewer could reliably see was
   * the date one, and only after editing a claim by hand to create it.
   *
   * This is how the mistake actually happens: a desk opens the last
   * pre-auth as a template, changes the patient and the clinical
   * details, and leaves "Name of surgery" filled in. The field is
   * conditional on a surgical line of treatment, so on this admission
   * it is not even shown — which is exactly why nobody notices it, and
   * why the checker reads the stored values rather than the visible
   * ones.
   *
   * Dengue, because a dengue admission naming a cholecystectomy is
   * unarguable: a reviewer does not have to know any medicine to see
   * that something was carried over. Everything else on the form is
   * deliberately clean, so the panel shows one finding rather than a
   * wall of them.
   */
  /*
    Sent twenty-five minutes ago, so the IRDAI hour is still running.

    At `daysAgo: 0.8` this claim was nineteen hours past a one-hour
    window the moment the seed finished, and the chip read "18h
    overdue" — true, but it shows the clock in the one state that is
    not a clock. Half an hour of countdown is what a desk actually
    looks at.

    It is perishable by construction: a one-hour window means any
    seeded countdown becomes an overdue in under an hour, and re-running
    the seed is the only thing that resets it. Worth knowing before a
    demo rather than during one.
  */
  /** Five hours ago. Shared with the form below so the two agree. */
  const TEMPLATED_ADMITTED_DAYS_AGO = 0.21;
  const templatedAdmission = ago(TEMPLATED_ADMITTED_DAYS_AGO);

  const templatedFormClaim = await openClaim({
    patientName: "Harish Bhandari",
    insurerId: vidal.id,
    procedureId: dengue.id,
    status: "PRE_AUTH_SENT",
    billedAmount: "65000",
    admittedDaysAgo: TEMPLATED_ADMITTED_DAYS_AGO,
    chain: [
      { status: "DRAFT", daysAgo: TEMPLATED_ADMITTED_DAYS_AGO },
      // Twenty-five minutes ago, inside IRDAI's hour.
      { status: "PRE_AUTH_SENT", daysAgo: 0.017 },
    ],
  });

  /*
    All three carry a filled form, because all three have been sent to
    an insurer and "0 of 25 confirmed" on a claim already sent is a
    contradiction. Only the knee had one, which held until somebody
    walked the dengue claim through to settled and the verifier asked
    how an insurer had paid against a blank form.

    The costing lines sum to the total they declare — a pre-auth that
    does not is the first thing a TPA sends back, and db:verify checks
    it.
  */
  const dengueForm = {
    treatingDoctorName: "Dr. Anjali Deshpande",
    treatingDoctorRegistrationNo: "MMC/2011/58203",
    illnessWithComplaints:
      "High fever 5 days, severe myalgia, petechial rash over both forearms",
    clinicalFindings:
      "Platelets 38,000/µL and falling, haematocrit 46%, NS1 antigen positive",
    ailmentDurationDays: "5",
    firstConsultationDate: ago(4).toISOString().slice(0, 10),
    provisionalDiagnosis: "Dengue fever with thrombocytopenia",
    icd10Code: "A90",
    // The stored value, not the label — see the note in seed-demo.ts.
    lineOfTreatment: "medical_management",
    admissionDate: ago(2).toISOString().slice(0, 10),
    admissionTime: "22:40",
    admissionType: "emergency",
    expectedStayDays: "4",
    roomType: "Twin sharing",
    roomRentPerDay: "4500",
    investigationCost: "22000",
    otCharges: "0",
    professionalFees: "28000",
    medicinesConsumables: "27000",
    totalExpectedCost: "95000",
  };

  const gallBladderForm = {
    treatingDoctorName: "Dr. Suresh Iyer",
    treatingDoctorRegistrationNo: "MMC/2007/33914",
    illnessWithComplaints:
      "Recurrent right upper quadrant pain after meals for 4 months",
    clinicalFindings:
      "Multiple calculi in gall bladder on ultrasound, wall thickness 4mm",
    ailmentDurationDays: "120",
    firstConsultationDate: ago(21).toISOString().slice(0, 10),
    provisionalDiagnosis: "Symptomatic cholelithiasis",
    icd10Code: "K80.2",
    lineOfTreatment: "surgical_management",
    surgeryName: "Laparoscopic cholecystectomy",
    admissionDate: ago(5).toISOString().slice(0, 10),
    admissionTime: "07:30",
    admissionType: "planned",
    expectedStayDays: "3",
    roomType: "Single private room",
    roomRentPerDay: "6000",
    investigationCost: "18500",
    otCharges: "52000",
    professionalFees: "61000",
    medicinesConsumables: "35500",
    totalExpectedCost: "185000",
  };

  /*
    The same dengue admission, with one field carried over.

    Every other value is deliberately clean — the dates are in order,
    the estimate sums to 65,000, the registration number is there — so
    the panel shows this one finding and not a wall of them. The only
    thing wrong is that `surgeryName` still holds the cholecystectomy
    from whichever pre-auth this form was copied from, on an admission
    whose line of treatment is medical.

    That field is conditional on a surgical line of treatment, so the
    form does not even render it here. A desk cannot see it; the
    checker reads the stored values rather than the visible ones, which
    is the entire reason it can catch this.
  */
  const templatedForm = {
    treatingDoctorName: "Dr. Nandita Rege",
    treatingDoctorRegistrationNo: "MMC/2013/61204",
    illnessWithComplaints:
      "Fever with chills for 4 days, retro-orbital pain, myalgia",
    clinicalFindings:
      "Platelets 52,000/µL, NS1 antigen positive, no bleeding manifestations",
    ailmentDurationDays: "4",
    firstConsultationDate: istDate(templatedAdmission),
    provisionalDiagnosis: "Dengue fever with thrombocytopenia",
    icd10Code: "A90",
    lineOfTreatment: "medical_management",
    // Left behind by the form this one was copied from.
    surgeryName: "Laparoscopic cholecystectomy",
    // Derived from the same moment the claim was admitted, so the form
    // and the claim it describes cannot drift apart.
    admissionDate: istDate(templatedAdmission),
    admissionTime: istTime(templatedAdmission),
    admissionType: "emergency",
    expectedStayDays: "5",
    roomType: "Twin sharing",
    // 3,200 x 5 = 16,000, and the rest brings it to exactly 65,000.
    roomRentPerDay: "3200",
    investigationCost: "18500",
    professionalFees: "14000",
    medicinesConsumables: "16500",
    totalExpectedCost: "65000",
  };

  for (const [claim, values, confirmedDaysAgo] of [
    [dengueClaim, dengueForm, 1.95],
    [gallBladderClaim, gallBladderForm, 4.85],
    [templatedFormClaim, templatedForm, 0.85],
  ] as const) {
    await db.insert(claimPreauthFields).values(
      Object.entries(values).map(([fieldKey, value]) => ({
        claimId: claim.id,
        fieldKey,
        value,
        confirmedAt: ago(confirmedDaysAgo),
      })),
    );
  }

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
      lineOfTreatment: "surgical_management",
      surgeryName: "Total knee replacement",
      admissionDate: ago(1).toISOString().slice(0, 10),
      admissionTime: "09:20",
      admissionType: "planned",
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

  console.log("Seeded Godavari Multispecialty Hospital with 3 claims.");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
