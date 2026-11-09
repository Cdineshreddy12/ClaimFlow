import { config } from "dotenv";
config({ path: "../../.env" });
config({ path: ".env" });

import { eq, inArray } from "drizzle-orm";
import type { ClaimStatus } from "@claimflow/contracts";
import { db } from "./client.js";
import {
  claimStatusEvents,
  claims,
  deductions,
  insurers,
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

  // --- the payers and procedures this history is spread across -------
  const payers = await db.select().from(insurers);
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

  // Ayushman Bharat is a package scheme: capped rates, not a bill the
  // hospital sets, so it is kept to the cheaper procedures.
  const scheme = payers.find((p) => p.type === "scheme");
  const commercial = payers.filter((p) => p.type !== "scheme");

  let settled = 0,
    awaitingPayment = 0,
    inFlight = 0,
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

    // Spread across six months, oldest first, so the monthly report has
    // a shape rather than a spike.
    const opened = 5 + Math.floor((i / PATIENTS.length) * 170);
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
        checklistSnapshot: [],
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

    // One in five picks up a query on the way through, which is what
    // the query inbox exists for and what drags turnaround out.
    const queried = rand() < 0.2;
    if (queried) {
      events.push({
        status: "QUERY_RAISED",
        at: new Date(preAuth.getTime() + between(2, 20) * 3_600_000),
      });
    }

    if (roll < 0.06) {
      // Rejected outright.
      events.push({
        status: "REJECTED",
        at: new Date(preAuth.getTime() + between(1, 4) * DAY),
      });
      await finish(claim.id, "REJECTED", events, {
        billedAmount: String(billed),
      });
      rejected++;
      continue;
    }

    const approvedAt = new Date(
      preAuth.getTime() + (queried ? between(2, 5) : between(1, 3)) * DAY,
    );
    const sanctioned = money(billed * 0.86, billed);
    events.push({ status: "APPROVED", at: approvedAt });

    if (roll < 0.2) {
      // Still being treated, or the bill is not raised yet.
      await finish(claim.id, "APPROVED", events, {
        billedAmount: String(billed),
        sanctionedAmount: String(sanctioned),
      });
      inFlight++;
      continue;
    }

    const billedAt = new Date(
      approvedAt.getTime() + profile.stay * DAY + between(0, 3) * DAY,
    );
    events.push({ status: "FINAL_BILL_SUBMITTED", at: billedAt });

    if (roll < 0.38) {
      // Billed and waiting on the insurer. These are the rows the
      // ageing report is built from, so they are spread deliberately
      // across its buckets rather than all landing in "0–30 days".
      await finish(claim.id, "FINAL_BILL_SUBMITTED", events, {
        billedAmount: String(billed),
        sanctionedAmount: String(sanctioned),
      });
      awaitingPayment++;
      continue;
    }

    // --- settled, with whatever the insurer cut on the way ----------
    const settledOn = new Date(billedAt.getTime() + between(12, 48) * DAY);
    if (settledOn.getTime() > Date.now()) {
      await finish(claim.id, "FINAL_BILL_SUBMITTED", events, {
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

  console.log(
    `seeded ${PATIENTS.length} claims over six months\n` +
      `  ${settled} settled (${deductionRows} deductions)\n` +
      `  ${awaitingPayment} billed, awaiting payment\n` +
      `  ${inFlight} approved, still in flight\n` +
      `  ${rejected} rejected`,
  );
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
      slaDeadline: null,
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
