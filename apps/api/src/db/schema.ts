import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Schema mirrors docs/ARCHITECTURE.md and the ADRs under docs/adr/,
 * especially 0001 (checklist engine), 0002 (tenant isolation),
 * 0004 (claim state machine), and 0006 (billing/onboarding).
 *
 * This connects to Postgres as the `postgres` superuser (see .env.example
 * and docs/adr/0002) — RLS defined alongside this schema in
 * src/db/migrations/0001_row_level_security.sql does NOT apply to queries
 * made through this schema/client. It protects any other, RLS-subject
 * connection (e.g. the Supabase anon/authenticated roles, if the frontend
 * ever talks to Supabase directly). Tenant isolation for everything that
 * goes through Drizzle is enforced in the Fastify route layer.
 */

export const userRole = pgEnum("user_role", [
  "platform_admin",
  "org_admin",
  "desk_head",
  "desk_executive",
  "doctor",
]);

export const claimStatus = pgEnum("claim_status", [
  "DRAFT",
  "PRE_AUTH_SENT",
  "QUERY_RAISED",
  "ENHANCEMENT_REQUESTED",
  "APPROVED",
  "FINAL_BILL_SUBMITTED",
  "SETTLED",
  "REJECTED",
]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  subscriptionStatus: text("subscription_status").notNull().default("trialing"),
  plan: text("plan").notNull().default("starter"),
  razorpayCustomerId: text("razorpay_customer_id"),
  razorpaySubscriptionId: text("razorpay_subscription_id"),
  // Set once, at signup — 14 days out, see docs/adr/0007. Enforcing
  // read-only access once this passes is billing-module work, not yet
  // built; this column only reserves the fact.
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),

  // --- Hospital profile (docs/adr/0008) ---
  // All nullable: signup creates the org with just a name so the user
  // gets in fast, then the onboarding wizard fills these. Validation
  // lives in @claimflow/contracts, enforced at the route, not as NOT NULL
  // constraints that would make a half-finished wizard unrepresentable.
  legalEntityName: text("legal_entity_name"),
  hospitalType: text("hospital_type"),
  ownershipType: text("ownership_type"),
  bedCount: integer("bed_count"),

  // IRDAI requires a ROHINI id for cashless settlement — the one
  // identifier a cashless desk genuinely cannot operate without.
  rohiniId: text("rohini_id"),
  registrationNumber: text("registration_number"),
  registrationValidUntil: date("registration_valid_until"),
  pan: text("pan"),
  gstin: text("gstin"),
  nabhStatus: text("nabh_status"),
  nabhValidUntil: date("nabh_valid_until"),

  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  pincode: text("pincode"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),

  // Whoever the TPA actually calls about a claim.
  deskContactName: text("desk_contact_name"),
  deskContactPhone: text("desk_contact_phone"),
  deskContactEmail: text("desk_contact_email"),

  /** Null until the wizard is finished — what the app checks to decide whether to route into onboarding. */
  onboardingCompletedAt: timestamp("onboarding_completed_at", {
    withTimezone: true,
  }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const orgMembers = pgTable(
  "org_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(), // references auth.users(id) — managed by Supabase, not this schema
    role: userRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique().on(table.userId),
    index("org_members_organization_id_idx").on(table.organizationId),
  ],
);

/**
 * A shareable link/code an org_admin generates for one role at a time —
 * see docs/adr/0007. Deliberately not tied to an invitee's email: there's
 * no email provider wired up, and link-sharing (WhatsApp, in person)
 * needs none. `usedAt`/`usedById` are null until someone redeems it;
 * redeeming is a one-time action enforced in the service layer, not here.
 */
export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: userRole("role").notNull(),
    token: text("token").notNull().unique(),
    createdBy: uuid("created_by").references(() => orgMembers.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    usedById: uuid("used_by_id"), // references auth.users(id), like org_members.userId
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("invites_organization_id_idx").on(table.organizationId)],
);

export const insurers = pgTable("insurers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'insurer' | 'tpa'
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const procedures = pgTable("procedures", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  code: text("code"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const checklistRules = pgTable(
  "checklist_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    insurerId: uuid("insurer_id")
      .notNull()
      .references(() => insurers.id),
    procedureId: uuid("procedure_id")
      .notNull()
      .references(() => procedures.id),
    documentType: text("document_type").notNull(),
    required: boolean("required").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique().on(
      table.organizationId,
      table.insurerId,
      table.procedureId,
      table.documentType,
    ),
    index("checklist_rules_org_lookup_idx").on(
      table.organizationId,
      table.insurerId,
      table.procedureId,
    ),
  ],
);

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    patientName: text("patient_name").notNull(),
    insurerId: uuid("insurer_id")
      .notNull()
      .references(() => insurers.id),
    procedureId: uuid("procedure_id")
      .notNull()
      .references(() => procedures.id),
    status: claimStatus("status").notNull().default("DRAFT"),
    assignedTo: uuid("assigned_to").references(() => orgMembers.id),
    // Snapshot of the checklist_rules that applied when this claim was
    // opened — see docs/adr/0001. Editing the live rules later must never
    // change what an in-flight claim requires.
    checklistSnapshot: jsonb("checklist_snapshot")
      .$type<{ documentType: string; required: boolean }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    billedAmount: numeric("billed_amount", { precision: 12, scale: 2 }),
    admittedAt: timestamp("admitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("claims_organization_id_idx").on(table.organizationId),
    index("claims_assigned_to_idx").on(table.assignedTo),
  ],
);

export const claimStatusEvents = pgTable(
  "claim_status_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    status: claimStatus("status").notNull(),
    actorId: uuid("actor_id").references(() => orgMembers.id),
    // Persisted server-side at write time — never computed from the
    // frontend clock. Backs the IRDAI/TPA SLA countdowns.
    slaDeadline: timestamp("sla_deadline", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("claim_status_events_claim_id_idx").on(table.claimId)],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    fileUrl: text("file_url").notNull(),
    /** Suggested checklist slot. A suggestion only — never a placement. */
    aiClassifiedType: text("ai_classified_type"),
    /** Where a human actually filed it. Null until someone confirms. */
    checklistSlot: text("checklist_slot"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    /** 'heuristic' | 'claude' — so the UI never calls a filename match "AI". */
    classifiedBy: text("classified_by"),
    /** Why the classifier thinks so; shown to the human before they confirm. */
    classificationReason: text("classification_reason"),
    confirmedBy: uuid("confirmed_by").references(() => orgMembers.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("documents_claim_id_idx").on(table.claimId)],
);

/**
 * One row per pre-auth form field the desk has either been offered a
 * value for or filled in. Sparse on purpose: a claim nobody has run the
 * extractor on has no rows here at all.
 *
 * The column split mirrors `documents` deliberately — `aiValue` is what
 * was suggested, `value` is what a human stands behind, and nothing
 * reads the suggestion as truth (docs/adr/0005). Keeping both means the
 * audit trail can always answer "what did the model say, and what did
 * the desk change it to".
 *
 * `value` is text for every field type; @claimflow/contracts owns the
 * catalogue, the per-type parsing and the canonical form. That keeps the
 * form's shape in one place both the API and the web app read, rather
 * than as two dozen columns that have to be migrated to add a field.
 */
export const claimPreauthFields = pgTable(
  "claim_preauth_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    /** A key from PREAUTH_FIELDS in @claimflow/contracts. */
    fieldKey: text("field_key").notNull(),
    /** What a human stands behind. Null until someone confirms or types one. */
    value: text("value"),
    /** The suggestion. Never read as truth, never copied here on its own. */
    aiValue: text("ai_value"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    /** Quoted from the document, shown before the human confirms. */
    sourceSnippet: text("source_snippet"),
    /** Which upload it was read out of, where the extractor could say. */
    sourceDocumentId: uuid("source_document_id").references(
      () => documents.id,
      {
        onDelete: "set null",
      },
    ),
    /** 'claude' — so the UI never implies a model ran when none did. */
    extractedBy: text("extracted_by"),
    extractedAt: timestamp("extracted_at", { withTimezone: true }),
    confirmedBy: uuid("confirmed_by").references(() => orgMembers.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("claim_preauth_fields_claim_id_idx").on(table.claimId),
    // One row per field per claim — re-running the extractor updates in
    // place rather than stacking up suggestions nobody asked for.
    unique("claim_preauth_fields_claim_id_field_key_key").on(
      table.claimId,
      table.fieldKey,
    ),
  ],
);

export const queries = pgTable(
  "queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    /** The source of truth. Always rendered under the summary — adr 0005. */
    tpaRawEmail: text("tpa_raw_email"),
    aiSummary: text("ai_summary"),
    requestedItems: jsonb("requested_items")
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** 'claude' when the summary was generated, null when a human typed it. */
    summarisedBy: text("summarised_by"),
    deadline: timestamp("deadline", { withTimezone: true }),
    /** True when the deadline was read out of the email rather than entered. */
    deadlineInferred: boolean("deadline_inferred").notNull().default(false),
    replySentAt: timestamp("reply_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("queries_claim_id_idx").on(table.claimId)],
);

/**
 * A one-off link a desk sends a treating doctor so they can approve the
 * clinical notes on a claim from their phone — no account, no login, per
 * the `doctor` role's definition in @claimflow/contracts.
 *
 * The token alone grants sight of one patient's documents, so it is
 * deliberately short-lived and single-decision: see docs/adr/0010 for
 * the exposure this trades away and the limits that bound it.
 */
export const doctorApprovals = pgTable(
  "doctor_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    /** Free text: the hospital knows who it sent this to, but doctors have no rows here. */
    doctorName: text("doctor_name").notNull(),
    requestedBy: uuid("requested_by").references(() => orgMembers.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** First time the link was opened — proves the doctor saw it, even if they never decide. */
    firstViewedAt: timestamp("first_viewed_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    declineReason: text("decline_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("doctor_approvals_claim_id_idx").on(table.claimId)],
);

/**
 * Money an insurer withheld against what was billed, with the reason.
 * Recorded by the desk at settlement — this is the number the client is
 * trying to cut by 40%, so it has to be attributable to a cause rather
 * than a single lump figure.
 *
 * Scoped through its claim, like documents and queries.
 */
export const deductions = pgTable(
  "deductions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    note: text("note"),
    recordedBy: uuid("recorded_by").references(() => orgMembers.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("deductions_claim_id_idx").on(table.claimId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => orgMembers.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("audit_log_organization_id_idx").on(table.organizationId)],
);
