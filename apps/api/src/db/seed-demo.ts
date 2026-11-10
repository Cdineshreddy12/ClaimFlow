import { config } from "dotenv";
config({ path: "../../.env" });
config({ path: ".env" });

import { and, eq, inArray, notInArray } from "drizzle-orm";
import { type ClaimStatus, slaDeadlineFor } from "@claimflow/contracts";
import { db } from "./client.js";
import {
  checklistRules,
  claimPreauthFields,
  claimStatusEvents,
  claims,
  deductions,
  insurers,
  members,
  procedures,
} from "./schema.js";

/**
 * Six months of desk history, so the reports have something to report.
 *
 * `seed.ts` creates the three claims from the product brief, which is
 * the right size for checking a screen renders and the wrong size for
 * showing what the product is for. Every analytic here is a statement
 * about a population: the ageing report needs claims that have been
 * waiting different lengths of time, the deduction risk warnings need
 * at least five settled claims on the same insurer and procedure
 * before they will say anything at all
 * (`PROCEDURE_SCOPE_MIN_CLAIMS`), and "92% of what you lost was
 * paperwork" is not a finding when it is three rows.
 *
 * Deliberately not random. A fixed seed means the demo is the same
 * demo tomorrow, and a number someone asks about can be found again.
 *
 *     pnpm --filter @claimflow/api db:seed:demo
 *     pnpm --filter @claimflow/api db:seed:demo -- --reset
 *
 * Additive, and it refuses to run twice without `--reset` — a second
 * pass would double every total on the dashboard.
 */

/** Deterministic PRNG, so this generates the same history every time. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(20261109);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo));
/** To the nearest 500 rupees — hospital billing does not land on odd numbers. */
const money = (lo: number, hi: number) =>
  Math.round(between(lo, hi) / 500) * 500;

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number, hour = 10) => {
  const d = new Date(Date.now() - n * DAY);
  d.setHours(hour, between(0, 59), 0, 0);
  return d;
};

/**
 * Real names from across India, because a desk in one hospital sees
 * patients from everywhere and a list of forty Sharmas does not look
 * like a patient list.
 */
const PATIENTS = [
  "Aarav Mehta",
  "Diya Krishnan",
  "Rohan Bhattacharya",
  "Ananya Pillai",
  "Vikram Chauhan",
  "Fatima Sheikh",
  "Karthik Subramanian",
  "Neha Agarwal",
  "Joseph Fernandes",
  "Sneha Reddy",
  "Harpreet Singh",
  "Lakshmi Iyer",
  "Mohammed Ansari",
  "Pooja Deshpande",
  "Arjun Nair",
  "Ritu Malhotra",
  "Sanjay Gowda",
  "Kavya Menon",
  "Deepak Jadhav",
  "Aisha Qureshi",
  "Nikhil Rao",
  "Shreya Banerjee",
  "Prakash Patel",
  "Divya Shetty",
  "Imran Khan",
  "Meenakshi Sundaram",
  "Gaurav Sinha",
  "Tanvi Joshi",
  "Rajesh Kulkarni",
  "Swati Verma",
  "Aditya Ghosh",
  "Nandini Raju",
  "Suresh Yadav",
  "Priyanka Dutta",
  "Manoj Tiwari",
  "Rekha Naidu",
  "Farhan Ahmed",
  "Geetha Prasad",
  "Amit Saxena",
  "Varsha Hegde",
  "Zubair Mirza",
  "Padma Lakshmi",
  "Nitin Bhardwaj",
  "Shalini Rathore",
  "Ravi Chandran",
  "Anjali Kapoor",
  "Devendra Shukla",
  "Maya Thomas",
  "Yusuf Pathan",
  "Bhavna Trivedi",
  "Srinivas Murthy",
  "Ishita Roy",
  "Kabir Grewal",
  "Leela Venkat",
  "Tarun Bose",
  "Nisha Kaul",
  "Abhishek Dubey",
  "Radhika Soni",
  "Vinod Kamath",
  "Alka Mishra",
  "Siddharth Ranganathan",
  "Jyoti Bisht",
  "Naveen Acharya",
  "Preeti Chandra",
  "Mustafa Lokhandwala",
  "Sunita Barman",
  "Ajay Panicker",
] as const;

/**
 * What each procedure costs and how long the patient stays. Both are
 * what make a claim look like a claim rather than a row — a knee
 * replacement billed at forty thousand would be noticed.
 */
const PROCEDURE_PROFILE: Record<
  string,
  { lo: number; hi: number; stay: number }
> = {
  "Total knee replacement": { lo: 255_000, hi: 345_000, stay: 5 },
  Angioplasty: { lo: 215_000, hi: 305_000, stay: 4 },
  "Gall bladder removal": { lo: 115_000, hi: 185_000, stay: 3 },
  "Caesarean section": { lo: 88_000, hi: 142_000, stay: 4 },
  "Hernia repair": { lo: 68_000, hi: 112_000, stay: 2 },
  Appendicectomy: { lo: 62_000, hi: 98_000, stay: 2 },
  "Dengue with low platelets": { lo: 42_000, hi: 88_000, stay: 4 },
  "Cataract surgery": { lo: 28_000, hi: 58_000, stay: 1 },
};

/** Added if missing — the first five already exist from seed.ts. */
const EXTRA_PROCEDURES = ["Angioplasty", "Hernia repair", "Cataract surgery"];

/**
 * The pairings this desk actually does a lot of.
 *
 * Spread evenly, sixty-odd claims across six payers and eight
 * procedures is two or three per combination, and the deduction risk
 * warnings stay silent — they need five settled claims on the same
 * insurer *and* procedure before they will prefer that narrow scope
 * over the insurer-wide one. Evenness is also wrong on its own terms:
 * a hospital has relationships, and the orthopaedic surgeon's knees go
 * to whichever insurer covers the implant.
 *
 * Most claims come from here; the rest are drawn freely, so the long
 * tail still exists.
 */
const REGULAR_WORK: readonly (readonly [string, string])[] = [
  ["Star Health Insurance", "Total knee replacement"],
  ["Star Health Insurance", "Caesarean section"],
  ["Niva Bupa Health Insurance", "Gall bladder removal"],
  ["Niva Bupa Health Insurance", "Angioplasty"],
  ["MediAssist TPA", "Appendicectomy"],
  ["Paramount Health TPA", "Hernia repair"],
  ["Vidal Health TPA", "Dengue with low platelets"],
  ["Ayushman Bharat PM-JAY", "Cataract surgery"],
] as const;

/**
 * How often each payer answers a cashless request inside IRDAI's hour.
 *
 * Stamping the deadline made the compliance column real, and it then
 * read 100% past target for every payer alike, because every seeded
 * decision took days. A column that says the same thing about everyone
 * measures nothing — the report exists to say which payer to chase, and
 * it can only say that if they differ.
 *
 * The spread is the one a desk would recognise: the insurers who
 * underwrite their own policies answer fastest, the third-party
 * administrators sit in the middle, and the government scheme is slowest
 * and least predictable.
 */
const ANSWERS_WITHIN_THE_HOUR: Record<string, number> = {
  "Star Health Insurance": 0.72,
  "Niva Bupa Health Insurance": 0.64,
  "MediAssist TPA": 0.41,
  "Paramount Health TPA": 0.33,
  "Vidal Health TPA": 0.28,
  "Ayushman Bharat PM-JAY": 0.09,
};

const DEDUCTION_PLAYBOOK = [
  {
    reason: "missing_document",
    share: 0.3,
    note: "Discharge summary page 2 not enclosed; TPA cut the room rent for the unevidenced days.",
  },
  {
    reason: "documentation_delay",
    share: 0.22,
    note: "Final bill submitted outside the insurer's 7-day window; late-submission clause applied.",
  },
  {
    reason: "incomplete_clinical_notes",
    share: 0.2,
    note: "Operative notes did not record implant serial numbers, so the implant line was disallowed.",
  },
  {
    reason: "policy_mismatch",
    share: 0.18,
    note: "Billed above the policy's room-rent sub-limit; proportionate deduction applied.",
  },
  {
    reason: "other",
    share: 0.1,
    note: "Non-payable consumables per the insurer's exclusion list.",
  },
] as const;

function reasonFor(r: number): (typeof DEDUCTION_PLAYBOOK)[number] {
  let acc = 0;
  for (const d of DEDUCTION_PLAYBOOK) {
    acc += d.share;
    if (r <= acc) return d;
  }
  return DEDUCTION_PLAYBOOK[DEDUCTION_PLAYBOOK.length - 1]!;
}

/**
 * What a cashless desk is asked for, which is nearly the same list
 * whoever the payer is. A claim opened against an insurer and
 * procedure with no rules gets an empty checklist and the file says
 * so — true, and useless as a demo, because the gap panel is the
 * screen the product is arguing for.
 */
const BASE_CHECKLIST: readonly (readonly [string, boolean])[] = [
  ["Pre-authorization form", true],
  ["Treating doctor's note", true],
  ["Photo ID proof", true],
  ["Policy / e-card copy", true],
  ["Investigation reports", true],
  ["Discharge summary", true],
  ["Final bill with break-up", true],
  ["Previous treatment records", false],
] as const;

/** The extra one each procedure's own evidence turns on. */
const PROCEDURE_EVIDENCE: Record<string, string> = {
  "Total knee replacement": "Implant sticker / invoice",
  Angioplasty: "Stent invoice and cath lab report",
  "Gall bladder removal": "Ultrasound report (abdomen)",
  "Caesarean section": "Obstetric ultrasound and LMP record",
  "Hernia repair": "Mesh invoice",
  Appendicectomy: "Histopathology report",
  "Dengue with low platelets": "Serial platelet count chart",
  "Cataract surgery": "IOL sticker",
};

/**
 * A pre-auth form as a desk leaves it: the clinical and admission
 * blocks filled from the doctor's note, the costing filled from the
 * estimate. Values are generated per claim so the totals match the
 * money on the claim rather than contradicting it.
 */
function preauthValues(opts: {
  procedure: string;
  billed: number;
  admittedAt: Date;
  stay: number;
}): Record<string, string> {
  const { procedure, billed, admittedAt, stay } = opts;
  const DOCTORS = [
    ["Dr. Ananthakrishnan V", "TN/14822/2009"],
    ["Dr. Priyanka Sahni", "DMC/R/8341/2012"],
    ["Dr. Rameshwar Joshi", "MMC/2004/41208"],
    ["Dr. Fatima Baig", "KMC/19/7734"],
    ["Dr. Siddharth Vaidya", "MMC/2011/55190"],
  ] as const;
  const [doctor, reg] = pick(DOCTORS);
  const CLINICAL: Record<string, [string, string, string, string]> = {
    "Total knee replacement": [
      "Severe bilateral knee pain, unable to climb stairs for 8 months",
      "Grade IV osteoarthritis, varus deformity, ROM 10-90 degrees",
      "Primary osteoarthritis of knee",
      "M17.0",
    ],
    Angioplasty: [
      "Exertional chest pain radiating to left arm since 3 weeks",
      "ECG ST depression in V4-V6; TMT positive; 90% LAD stenosis on angiography",
      "Coronary artery disease, single vessel",
      "I25.10",
    ],
    "Gall bladder removal": [
      "Recurrent right upper quadrant pain after meals for 4 months",
      "Murphy's sign positive; USG shows multiple calculi, wall 4mm",
      "Chronic calculous cholecystitis",
      "K80.10",
    ],
    "Caesarean section": [
      "Primigravida at 39 weeks with breech presentation",
      "Breech, EFW 3.1kg, inadequate pelvis on assessment",
      "Breech presentation at term",
      "O32.1",
    ],
    "Hernia repair": [
      "Right groin swelling increasing on straining for 6 months",
      "Reducible right inguinal hernia, cough impulse present",
      "Unilateral inguinal hernia",
      "K40.90",
    ],
    Appendicectomy: [
      "Acute right iliac fossa pain with vomiting since 18 hours",
      "Rebound tenderness at McBurney's point; WBC 14,800; USG probe tenderness",
      "Acute appendicitis",
      "K35.80",
    ],
    "Dengue with low platelets": [
      "High fever with retro-orbital pain and myalgia for 5 days",
      "NS1 positive; platelets fallen 148k to 42k over 72 hours; no bleeding",
      "Dengue fever with thrombocytopenia",
      "A90",
    ],
    "Cataract surgery": [
      "Progressive blurring of vision in right eye for 1 year",
      "Nuclear sclerosis grade III, BCVA 6/36, IOP 14 mmHg",
      "Senile nuclear cataract",
      "H25.1",
    ],
  };
  const c = CLINICAL[procedure] ?? CLINICAL["Appendicectomy"]!;
  const two = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const firstSeen = new Date(admittedAt.getTime() - between(3, 21) * DAY);

  // The costing adds up to the billed amount, because a pre-auth whose
  // lines do not sum to its own total is the first thing a TPA queries.
  const room = Math.round((billed * 0.22) / stay / 100) * 100;
  const roomTotal = room * stay;
  const investigation = Math.round((billed * 0.12) / 100) * 100;
  const ot = Math.round((billed * 0.18) / 100) * 100;
  const meds = Math.round((billed * 0.24) / 100) * 100;
  // Whatever the rounding left over lands here rather than being
  // clamped away, because a form whose lines do not sum to its own
  // total is the first thing a TPA sends back.
  const fees = billed - roomTotal - investigation - ot - meds;

  return {
    treatingDoctorName: doctor,
    treatingDoctorRegistrationNo: reg,
    illnessWithComplaints: c[0],
    clinicalFindings: c[1],
    ailmentDurationDays: String(between(4, 180)),
    firstConsultationDate: iso(firstSeen),
    provisionalDiagnosis: c[2],
    icd10Code: c[3],
    lineOfTreatment:
      procedure === "Dengue with low platelets"
        ? "Conservative management"
        : "Surgical management",
    surgeryName: procedure,
    admissionDate: iso(admittedAt),
    admissionTime: `${two(admittedAt.getHours())}:${two(admittedAt.getMinutes())}`,
    admissionType: "Planned",
    expectedStayDays: String(stay),
    roomType: billed > 200_000 ? "Single private room" : "Twin sharing",
    roomRentPerDay: String(room),
    investigationCost: String(investigation),
    otCharges: String(ot),
    professionalFees: String(fees),
    medicinesConsumables: String(Math.max(meds, 0)),
    totalExpectedCost: String(billed),
  };
}

const SENTINEL = PATIENTS[0];

async function main(): Promise<void> {
  const reset = process.argv.includes("--reset");

  const already = await db
    .select({ id: claims.id })
    .from(claims)
    .where(eq(claims.patientName, SENTINEL));

  if (already.length > 0 && !reset) {
    console.log(
      `Demo history is already seeded (found "${SENTINEL}").\n` +
        `Re-run with --reset to replace it; running twice would double every total.`,
    );
    return;
  }

  if (reset) {
    const names = [...PATIENTS];
    const gone = await db
      .delete(claims)
      .where(inArray(claims.patientName, names))
      .returning({ ref: claims.reference });
    console.log(`reset: removed ${gone.length} previously generated claims`);
  }

  /*
    --- the payers and procedures this history is spread across -------

    Only the payers this file actually knows, the same way the
    procedures below are filtered to the ones it has a profile for.

    Reading every row instead meant reading whatever else was in the
    table, and the integration tests leave insurers behind when a run
    is interrupted — so thirteen demo claims came out billed to "Risk
    Test Insurer 1794235447499-39rrr". A generator that draws from
    whatever it finds inherits every stray row as content.
  */
  const DEMO_PAYERS = new Set(REGULAR_WORK.map(([insurerName]) => insurerName));
  const payers = (await db.select().from(insurers)).filter((p) =>
    DEMO_PAYERS.has(p.name),
  );
  if (payers.length === 0) throw new Error("No insurers — run db:seed first.");

  for (const name of EXTRA_PROCEDURES) {
    const [existing] = await db
      .select({ id: procedures.id })
      .from(procedures)
      .where(eq(procedures.name, name));
    if (!existing) await db.insert(procedures).values({ name });
  }
  const procs = (await db.select().from(procedures)).filter(
    (p) => p.isActive && PROCEDURE_PROFILE[p.name],
  );

  // Rules for every pairing this desk works, so a generated claim
  // carries a checklist instead of the "no rules existed" notice. Only
  // where none exist — an insurer/procedure someone already configured
  // is left exactly as they configured it.
  for (const [insurerName, procedureName] of REGULAR_WORK) {
    const payer = payers.find((x) => x.name === insurerName);
    const proc = procs.find((x) => x.name === procedureName);
    if (!payer || !proc) continue;
    const [has] = await db
      .select({ id: checklistRules.id })
      .from(checklistRules)
      .where(
        and(
          eq(checklistRules.insurerId, payer.id),
          eq(checklistRules.procedureId, proc.id),
        ),
      );
    if (has) continue;
    const evidence = PROCEDURE_EVIDENCE[proc.name];
    await db.insert(checklistRules).values([
      ...BASE_CHECKLIST.map(([documentType, required]) => ({
        insurerId: payer.id,
        procedureId: proc.id,
        documentType,
        required,
      })),
      ...(evidence
        ? [
            {
              insurerId: payer.id,
              procedureId: proc.id,
              documentType: evidence,
              required: true,
            },
          ]
        : []),
    ]);
  }

  // The scheme payer reaches claims through REGULAR_WORK, which pairs
  // Ayushman Bharat with cataracts — capped package rates, not a bill
  // the hospital sets. Only the free draw excludes it, so a scheme
  // claim never lands on a three-lakh knee.
  const commercial = payers.filter((p) => p.type !== "scheme");

  let settled = 0,
    awaitingPayment = 0,
    inFlight = 0,
    awaitingDecision = 0,
    awaitingDischarge = 0,
    rejected = 0;
  let deductionRows = 0;

  for (let i = 0; i < PATIENTS.length; i++) {
    const patient = PATIENTS[i]!;

    // Three in four come from the regular work above, which is what
    // gives any one insurer/procedure pair enough settled claims to
    // say something about.
    let proc = pick(procs);
    let payer = pick(commercial);
    const regular = rand() < 0.75 ? pick(REGULAR_WORK) : null;
    if (regular) {
      const p = payers.find((x) => x.name === regular[0]);
      const q = procs.find((x) => x.name === regular[1]);
      if (p && q) {
        payer = p;
        proc = q;
      }
    }
    const profile = PROCEDURE_PROFILE[proc.name]!;
    const isScheme = payer.type === "scheme";

    /*
      Spread across six months, oldest first, so the monthly report has
      a shape rather than a spike — except for the first few, which are
      admitted inside the last week.

      A hospital always has inpatients, and the claim stages only look
      right if some claims are genuinely mid-treatment. Starting the
      whole run five days back left almost nothing young enough to still
      be awaiting its bill, so "approved, not yet billed" came out
      nearly empty once that stage stopped being filled by old claims
      that had simply been abandoned there.
    */
    const admittedThisWeek = 5;
    const opened =
      i < admittedThisWeek
        ? 1 + i
        : 5 +
          Math.floor(
            ((i - admittedThisWeek) / (PATIENTS.length - admittedThisWeek)) *
              170,
          );
    const admittedAt = daysAgo(opened, between(8, 20));
    const billed = isScheme
      ? money(profile.lo * 0.7, profile.hi * 0.75)
      : money(profile.lo, profile.hi);

    const roll = rand();
    const [claim] = await db
      .insert(claims)
      .values({
        patientName: patient,
        insurerId: payer.id,
        procedureId: proc.id,
        status: "DRAFT",
        admittedAt,
        createdAt: admittedAt,
        updatedAt: admittedAt,
        ...(isScheme
          ? {
              packageCode: `HBP-${between(1000, 9999)}`,
              packageRate: String(billed),
            }
          : {}),
        // Frozen at open time, exactly as claims.service does it
        // (docs/adr/0001) — the claim keeps the list it was opened
        // against even if the rules change later.
        // A quarter of these are drawn freely rather than from the
        // regular pairings, and those landed on insurer/procedure
        // combinations nobody had configured — eighteen claims whose
        // file opened on "this claim has no checklist". The rules are
        // created on first use instead, so the empty state stays
        // reachable by opening a claim on a new pairing rather than
        // being most of the demo.
        checklistSnapshot: await ensureRules(payer.id, proc.id, proc.name),
      })
      .returning();
    if (!claim) continue;

    const events: { status: ClaimStatus; at: Date }[] = [
      { status: "DRAFT", at: admittedAt },
      {
        status: "PRE_AUTH_SENT",
        at: new Date(admittedAt.getTime() + between(1, 6) * 3_600_000),
      },
    ];
    const preAuth = events[1]!.at;

    /*
      How long this payer takes to come back at all.

      Turnaround measures the gap from PRE_AUTH_SENT to whatever happens
      next, so this is the number IRDAI's hour is judged against —
      whether the answer is an approval, a query or a refusal. It is the
      payer's own rate that decides, which is what makes one column of
      the report different from another.
    */
    const withinTheHour =
      rand() < (ANSWERS_WITHIN_THE_HOUR[payer.name] ?? 0.35);
    const firstResponse = withinTheHour
      ? between(10, 58) * 60_000
      : between(3, 72) * 3_600_000;

    // One in five picks up a query on the way through, which is what
    // the query inbox exists for and what drags turnaround out.
    const queried = rand() < 0.2;
    if (queried) {
      events.push({
        status: "QUERY_RAISED",
        at: new Date(preAuth.getTime() + firstResponse),
      });
    }

    if (roll < 0.06) {
      // Rejected outright.
      events.push({
        status: "REJECTED",
        at: new Date(
          preAuth.getTime() +
            (queried ? firstResponse + between(1, 4) * DAY : firstResponse),
        ),
      });
      await finish(claim.id, "REJECTED", events, {
        billedAmount: String(billed),
      });
      rejected++;
      continue;
    }

    // A claim that reached an insurer had a form filled in to reach
    // them with. Drafts and the freshly-sent keep theirs empty, which
    // is what the extract-and-confirm flow is demonstrated on — but
    // every claim still here is on its way to APPROVED at least, and
    // the 15% that used to be skipped produced thirteen claims an
    // insurer had approved against a blank form. The empty state comes
    // from the drafts, not from losing paperwork after the fact.
    const values = preauthValues({
      procedure: proc.name,
      billed,
      admittedAt,
      stay: profile.stay,
    });
    const confirmedAt = new Date(preAuth.getTime() - 30 * 60_000);
    await db.insert(claimPreauthFields).values(
      Object.entries(values).map(([fieldKey, value]) => ({
        claimId: claim.id,
        fieldKey,
        value,
        confirmedAt,
      })),
    );

    // Answered inside the payer's own response time, or — if they came
    // back with a query first — a couple of days after that was settled.
    const approvedAt = new Date(
      preAuth.getTime() +
        (queried ? firstResponse + between(1, 4) * DAY : firstResponse),
    );

    // The insurer has not answered yet. Every stage boundary has to be
    // a date that has actually arrived: approving a claim next Tuesday
    // put CLM-2058 and CLM-2060 in the future, where nothing but the
    // verifier could see them. This is also what fills the pre-auth and
    // query stages, which is where a desk's own clock is running.
    if (approvedAt.getTime() > Date.now()) {
      await finish(
        claim.id,
        queried ? "QUERY_RAISED" : "PRE_AUTH_SENT",
        events,
        {
          billedAmount: String(billed),
        },
      );
      awaitingDecision++;
      continue;
    }

    // Usually the insurer sanctions enough and nothing is said about
    // it. Making every claim fall short, as this first did, put a
    // "needs cover" flag on all sixty-seven and turned the one signal
    // that should mean something into wallpaper.
    const sanctioned =
      rand() < 0.72
        ? money(billed * 1.02, billed * 1.2)
        : money(billed * 0.72, billed * 0.94);
    events.push({ status: "APPROVED", at: approvedAt });

    const billedAt = new Date(
      approvedAt.getTime() + profile.stay * DAY + between(0, 3) * DAY,
    );

    /*
      Still being treated, or the bill is not raised yet — which is
      true exactly while the bill date has not arrived, so that is the
      test rather than a dice roll.

      Drawing this set at random ignored how old the claim was, and two
      things followed. Claims that opened five months ago sat in
      "approved, not yet billed", which reads as a desk that walked away
      rather than one with work in hand. And the claims that did get
      billed had no upper bound on the bill date, so one escaped into
      the data submitted tomorrow.

      A bill still outstanding months later is a different thing and
      stays: that is what the receivables ageing buckets are made of.
      An *approval* nobody has billed against for months is not.
    */
    if (billedAt.getTime() > Date.now()) {
      await finish(claim.id, "APPROVED", events, {
        billedAmount: String(billed),
        sanctionedAmount: String(sanctioned),
      });
      inFlight++;
      continue;
    }

    events.push({ status: "FINAL_BILL_SUBMITTED", at: billedAt });

    /*
      How long the insurer takes to let the patient go, which is the
      answer IRDAI gives them three hours for — and the thing the final
      bill's SLA window has always named and never measured, because
      settlement used to be the only event that could follow it.

      Hours, not the weeks that the money takes. A payer quick on a
      cashless request tends to be quick here too, so the same rate
      decides it and the two columns of the turnaround report agree
      with each other about who is slow.
    */
    const authorisedInTime =
      rand() < (ANSWERS_WITHIN_THE_HOUR[payer.name] ?? 0.35);
    const authorisedAt = new Date(
      billedAt.getTime() +
        (authorisedInTime
          ? between(20, 170) * 60_000
          : between(4, 30) * 3_600_000),
    );

    // The bill is in and the patient is still on the ward waiting to be
    // let go. A few hours wide, so only a claim billed today is here.
    if (authorisedAt.getTime() > Date.now()) {
      await finish(claim.id, "FINAL_BILL_SUBMITTED", events, {
        billedAmount: String(billed),
        sanctionedAmount: String(sanctioned),
      });
      awaitingDischarge++;
      continue;
    }

    events.push({ status: "DISCHARGE_AUTHORISED", at: authorisedAt });

    if (roll < 0.38) {
      // Discharged and waiting on the money. These are the rows the
      // ageing report is built from, so they are spread deliberately
      // across its buckets rather than all landing in "0–30 days".
      await finish(claim.id, "DISCHARGE_AUTHORISED", events, {
        billedAmount: String(billed),
        sanctionedAmount: String(sanctioned),
      });
      awaitingPayment++;
      continue;
    }

    // --- settled, with whatever the insurer cut on the way ----------
    // Payment follows the discharge, not the bill: the patient has been
    // gone for weeks by the time the transfer lands.
    const settledOn = new Date(authorisedAt.getTime() + between(12, 48) * DAY);
    if (settledOn.getTime() > Date.now()) {
      await finish(claim.id, "DISCHARGE_AUTHORISED", events, {
        billedAmount: String(billed),
        sanctionedAmount: String(sanctioned),
      });
      awaitingPayment++;
      continue;
    }

    let cut = 0;
    const cuts: { reason: string; amount: number; note: string }[] = [];
    // Most claims are paid close to the bill; the interesting ones are
    // not, and the product's whole argument is about why.
    if (rand() < 0.55) {
      const d = reasonFor(rand());
      const amount = money(billed * 0.03, billed * 0.16);
      cuts.push({ reason: d.reason, amount, note: d.note });
      cut += amount;
      // A second reason on the larger claims, which is how it really goes.
      if (billed > 150_000 && rand() < 0.35) {
        const d2 = reasonFor(rand());
        const a2 = money(billed * 0.02, billed * 0.07);
        cuts.push({ reason: d2.reason, amount: a2, note: d2.note });
        cut += a2;
      }
    }

    for (const c of cuts) {
      // Roughly a third get contested, and of those about half come
      // back with something — which is what makes the appeals column
      // worth looking at.
      const contest = rand();
      const appealStatus =
        contest < 0.66
          ? "NOT_CONTESTED"
          : contest < 0.78
            ? "CONTESTED"
            : contest < 0.9
              ? "RECOVERED"
              : contest < 0.96
                ? "PARTIALLY_RECOVERED"
                : "UPHELD";
      const recovered =
        appealStatus === "RECOVERED"
          ? c.amount
          : appealStatus === "PARTIALLY_RECOVERED"
            ? Math.round(c.amount * 0.5)
            : null;
      await db.insert(deductions).values({
        claimId: claim.id,
        reason: c.reason,
        amount: String(c.amount),
        note: c.note,
        appealStatus,
        ...(recovered !== null ? { recoveredAmount: String(recovered) } : {}),
        ...(appealStatus !== "NOT_CONTESTED"
          ? { contestedAt: new Date(settledOn.getTime() + 2 * DAY) }
          : {}),
        ...(recovered !== null
          ? {
              resolvedAt: new Date(settledOn.getTime() + between(10, 30) * DAY),
            }
          : {}),
      });
      deductionRows++;
    }

    events.push({ status: "SETTLED", at: settledOn });
    await finish(claim.id, "SETTLED", events, {
      billedAmount: String(billed),
      sanctionedAmount: String(sanctioned),
      settledAmount: String(billed - cut),
      settledOn: settledOn.toISOString().slice(0, 10),
    });
    settled++;
  }

  const assigned = await giveTheExecutiveSomeWork();

  console.log(
    `seeded ${PATIENTS.length} claims over six months\n` +
      `  ${settled} settled (${deductionRows} deductions)\n` +
      `  ${awaitingPayment} billed, awaiting payment\n` +
      `  ${inFlight} approved, still in flight\n` +
      `  ${awaitingDecision} sent, awaiting the insurer\n` +
      `  ${awaitingDischarge} billed, awaiting discharge authorisation\n` +
      `  ${rejected} rejected` +
      (assigned === null
        ? `\n  (no desk executive on this install, so nothing was assigned)`
        : `\n  ${assigned} assigned to the desk executive`),
  );
}

/**
 * Puts some of the open work on the desk executive's plate.
 *
 * Their whole role is scoped to `claims.assigned_to`, so a demo where
 * nothing is assigned shows them an empty list, an empty query inbox
 * and an empty dashboard — which reads as a broken build rather than
 * as a role boundary working.
 *
 * Only the open ones: handing someone a stack of settled claims is not
 * a workload. Returns null when nobody holds that role, because the
 * seed creates claims and Supabase creates people — this cannot invent
 * a member to assign to.
 */
async function giveTheExecutiveSomeWork(): Promise<number | null> {
  const [executive] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.role, "desk_executive"))
    .limit(1);
  if (!executive) return null;

  const open = await db
    .select({ id: claims.id })
    .from(claims)
    .where(
      and(
        inArray(claims.patientName, [...PATIENTS]),
        notInArray(claims.status, ["SETTLED", "REJECTED"]),
      ),
    );

  // Every third one, so the list is a mix rather than one person's
  // whole desk — a desk head still has plenty to look at.
  const mine = open.filter((_, i) => i % 3 === 0).map((c) => c.id);
  if (mine.length === 0) return 0;

  await db
    .update(claims)
    .set({ assignedTo: executive.id })
    .where(inArray(claims.id, mine));
  return mine.length;
}

/** The rules for this pairing, creating the standard set if it has none. */
async function ensureRules(
  insurerId: string,
  procedureId: string,
  procedureName: string,
) {
  const read = () =>
    db
      .select({
        documentType: checklistRules.documentType,
        required: checklistRules.required,
      })
      .from(checklistRules)
      .where(
        and(
          eq(checklistRules.insurerId, insurerId),
          eq(checklistRules.procedureId, procedureId),
        ),
      );

  const existing = await read();
  if (existing.length > 0) return existing;

  const evidence = PROCEDURE_EVIDENCE[procedureName];
  await db.insert(checklistRules).values([
    ...BASE_CHECKLIST.map(([documentType, required]) => ({
      insurerId,
      procedureId,
      documentType,
      required,
    })),
    ...(evidence
      ? [{ insurerId, procedureId, documentType: evidence, required: true }]
      : []),
  ]);
  return read();
}

/** Writes the event chain and the claim's final shape in one place. */
async function finish(
  claimId: string,
  status: ClaimStatus,
  events: { status: ClaimStatus; at: Date }[],
  fields: Partial<typeof claims.$inferInsert>,
): Promise<void> {
  for (const e of events) {
    await db.insert(claimStatusEvents).values({
      claimId,
      status: e.status,
      actorId: null,
      // Stamped from the same table the server stamps from, rather than
      // left null. Turnaround counts a breach as `answered_at >
      // sla_deadline`, so an event with no deadline can never be one —
      // every seeded claim reported perfect compliance because the
      // column was empty, not because anybody met the hour.
      slaDeadline: slaDeadlineFor(e.status, e.at),
      createdAt: e.at,
    });
  }
  const last = events[events.length - 1]!.at;
  await db
    .update(claims)
    // `updatedAt` is what the list's "time in stage" column measures
    // from, so it has to be when the claim last actually moved.
    .set({ ...fields, status, updatedAt: last })
    .where(eq(claims.id, claimId));
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
