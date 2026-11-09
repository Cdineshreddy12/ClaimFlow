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
 * especially 0001 (checklist engine), 0002 (authorization),
 * 0004 (claim state machine), and 0006 (onboarding).
 *
 * One install per hospital — there is no tenant column on anything, and
 * `hospital_profile` holds the single hospital's identity (docs/adr/0002,
 * revised in 0011). Authorization is by role, not by scope: every signed-in
 * member is a member of the one hospital.
 *
 * This connects to Postgres as the `postgres` superuser (see .env.example
 * and docs/adr/0002) — RLS defined alongside this schema in the migrations
 * does NOT apply to queries made through this schema/client. It protects
 * any other, RLS-subject connection (e.g. the Supabase anon/authenticated
 * roles, if the frontend ever talks to Supabase directly). Role checks for
 * everything that goes through Drizzle are enforced in the Fastify route
 * layer.
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
  "DISCHARGE_AUTHORISED",
  "SETTLED",
  "REJECTED",
]);

/**
 * An enhancement's own lifecycle. Separate from the claim's: a claim
 * sits in ENHANCEMENT_REQUESTED while exactly one enhancement is open,
 * but the claim moves on and the enhancement's outcome has to stay
 * readable afterwards (docs/adr/0004 wanted this distinction; docs/adr/
 * 0012 is where it finally got its data).
 */
export const enhancementStatus = pgEnum("enhancement_status", [
  "REQUESTED",
  "APPROVED",
  "PARTIALLY_APPROVED",
  "REJECTED",
  "WITHDRAWN",
]);

/**
 * How far an appeal against one deduction has got. `NOT_CONTESTED` is
 * the default because most deductions are accepted without a fight —
 * which is exactly the habit docs/adr/0013 exists to change.
 */
export const deductionAppealStatus = pgEnum("deduction_appeal_status", [
  "NOT_CONTESTED",
  "CONTESTED",
  "RECOVERED",
  "PARTIALLY_RECOVERED",
  "UPHELD",
]);

/**
 * The hospital this install belongs to — exactly one row, enforced by a
 * unique index on a constant (see migration 0014).
 *
 * This is identity, not tenancy. Every field here lands on a pre-auth
 * form or identifies the hospital to a TPA, which is why removing
 * multi-tenancy didn't remove the table: a cashless desk cannot send
 * anything without a ROHINI id and a registration number.
 */
export const hospitalProfile = pgTable("hospital_profile", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),

  // --- Hospital profile (docs/adr/0008) ---
  // All nullable: the row is created with just a name so the first user
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

  // --- Document branding (docs/adr/0008 follow-up) ---
  // What the printed pre-auth form looks like, as opposed to what it
  // says. Entirely optional and never gates onboarding — a desk can
  // print and fax a form with no logo set, the way it always has.
  /** S3 object key of the uploaded letterhead logo, not a URL — see hospital.service.ts for why. */
  logoFileKey: text("logo_file_key"),
  /** Hex, e.g. "#1A73E8" — colors the form's title on the printed PDF. */
  brandAccentColor: text("brand_accent_color"),
  tagline: text("tagline"),
  /** Free text printed under the declaration, e.g. bank details or a closing note. */
  documentFooterNote: text("document_footer_note"),
  /** "classic" | "ruled" | "compact" — styling only; every template prints the same fields. */
  preauthTemplate: text("preauth_template"),
  /** The rest of the form switches. Null reads as all-defaults — see PreauthOptions. */
  preauthOptions: jsonb("preauth_options"),

  /** Null until the wizard is finished — what the app checks to decide whether to route into onboarding. */
  onboardingCompletedAt: timestamp("onboarding_completed_at", {
    withTimezone: true,
  }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Desk staff. Role is the whole of authorization now — see docs/adr/0002. */
export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(), // references auth.users(id) — managed by Supabase, not this schema
    role: userRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.userId)],
);

/**
 * A shareable link/code an admin generates for one role at a time —
 * see docs/adr/0007. Deliberately not tied to an invitee's email: there's
 * no email provider wired up, and link-sharing (WhatsApp, in person)
 * needs none. `usedAt`/`usedById` are null until someone redeems it;
 * redeeming is a one-time action enforced in the service layer, not here.
 */
export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  role: userRole("role").notNull(),
  token: text("token").notNull().unique(),
  createdBy: uuid("created_by").references(() => members.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  usedById: uuid("used_by_id"), // references auth.users(id), like members.userId
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insurers = pgTable("insurers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'insurer' | 'tpa'
  /** The desk's own shorthand, as it appears on their correspondence. */
  code: text("code"),
  contactEmail: text("contact_email"),
  /**
   * Retired rather than deleted. An insurer with claims against it can
   * never be removed without those claims losing the name they were
   * filed under; this takes it off the list for new ones instead.
   */
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const procedures = pgTable("procedures", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  code: text("code"),
  /**
   * Retired rather than deleted, for the same reason as an insurer: a
   * procedure with claims against it can never be removed without those
   * claims losing the name they were opened under. This takes it off
   * the pickers instead, and can be undone.
   */
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const checklistRules = pgTable(
  "checklist_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    unique().on(table.insurerId, table.procedureId, table.documentType),
    index("checklist_rules_lookup_idx").on(table.insurerId, table.procedureId),
  ],
);

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * What a desk and a TPA actually call this claim — "CLM-0042".
     * Generated by a sequence in the database (migration 0016) so two
     * concurrent inserts can't land on the same one. The uuid above
     * stays the key and stays in URLs; this is the part people read.
     */
    reference: text("reference")
      .notNull()
      .default(
        sql`'CLM-' || lpad(nextval('claim_reference_seq')::text, 4, '0')`,
      ),
    patientName: text("patient_name").notNull(),
    insurerId: uuid("insurer_id")
      .notNull()
      .references(() => insurers.id),
    procedureId: uuid("procedure_id")
      .notNull()
      .references(() => procedures.id),
    status: claimStatus("status").notNull().default("DRAFT"),
    assignedTo: uuid("assigned_to").references(() => members.id),
    // Snapshot of the checklist_rules that applied when this claim was
    // opened — see docs/adr/0001. Editing the live rules later must never
    // change what an in-flight claim requires.
    checklistSnapshot: jsonb("checklist_snapshot")
      // `addedAt`/`addedBy` are present only on slots a person added to
      // this one claim after it was opened — the provenance that keeps
      // docs/adr/0001's amendment honest, and what tells a removal
      // which slots it may touch.
      .$type<
        {
          documentType: string;
          required: boolean;
          // `| undefined` spelled out: exactOptionalPropertyTypes is on,
          // so an optional property and one that may hold undefined are
          // different types, and the zod schema infers the latter.
          addedAt?: string | undefined;
          addedBy?: string | null | undefined;
          /**
           * True when the slot is one of the insurer's own
           * requirements, restored onto a claim that was opened
           * without a checklist. Added by a person, but not their
           * judgement — so it is no more removable than a slot that
           * was snapshotted at creation.
           */
          fromRules?: boolean | undefined;
        }[]
      >()
      .notNull()
      .default(sql`'[]'::jsonb`),
    billedAmount: numeric("billed_amount", { precision: 12, scale: 2 }),
    /**
     * What the insurer actually authorised — not what the hospital asked
     * for (that's the pre-auth form's `totalExpectedCost`) and not what
     * it eventually billed. Without this column the shortfall a claim
     * ends in is uncomputable, and an enhancement has no limit to be
     * requested against: see docs/adr/0012.
     */
    sanctionedAmount: numeric("sanctioned_amount", { precision: 12, scale: 2 }),
    /**
     * Government scheme claims only: the package picked from the
     * scheme's rate master, and what that package pays.
     *
     * Both or neither, enforced by a check constraint. The rate is
     * fixed by the scheme rather than negotiated, which is why it also
     * lands in `sanctionedAmount` at creation — see
     * contracts/claims/scheme-package.
     */
    packageCode: text("package_code"),
    packageRate: numeric("package_rate", { precision: 12, scale: 2 }),
    /**
     * What the insurer actually paid, and when it arrived — not what
     * they authorised. The gap between this and sanctionedAmount is
     * the deduction the desk is trying to shrink.
     */
    settledAmount: numeric("settled_amount", { precision: 12, scale: 2 }),
    /** A date, not a timestamp — a payment lands on a day, not at an instant. */
    settledOn: date("settled_on"),
    /**
     * The pre-auth form as it stood when this claim was opened. Same
     * guarantee as checklistSnapshot (docs/adr/0001): editing the form
     * must never change what an in-flight claim asked for.
     */
    preauthLayoutSnapshot: jsonb("preauth_layout_snapshot"),
    admittedAt: timestamp("admitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("claims_assigned_to_idx").on(table.assignedTo)],
);

export const claimStatusEvents = pgTable(
  "claim_status_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    status: claimStatus("status").notNull(),
    actorId: uuid("actor_id").references(() => members.id),
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
    /**
     * When it was last read — not when it was uploaded.
     *
     * A classification answers "which of these slots", and the claim's
     * checklist changes underneath it. This is what lets the claim
     * screen tell a current reading from one that predates a slot the
     * claim has since gained.
     */
    classifiedAt: timestamp("classified_at", { withTimezone: true }),
    confirmedBy: uuid("confirmed_by").references(() => members.id),
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
    confirmedBy: uuid("confirmed_by").references(() => members.id),
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

/**
 * A configurable pre-auth form: layout -> section -> placement ->
 * definition. Model adapted from the b2b-crm dynamic-form system; the
 * split is what lets the renderer stay ignorant of the fields.
 */
export const preauthFieldDefinitions = pgTable(
  "preauth_field_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Immutable once anything references it — values are filed under this. */
    fieldKey: text("field_key").notNull(),
    label: text("label").notNull(),
    fieldType: text("field_type").notNull(),
    hint: text("hint"),
    options: jsonb("options").$type<{ value: string; label: string }[]>(),
    /** The 24 IRDAI fields: re-orderable, never deleted or retyped. */
    isStandard: boolean("is_standard").notNull().default(false),
    conditionalOn: jsonb("conditional_on").$type<{
      fieldKey: string;
      equals: string;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.fieldKey)],
);

export const preauthLayouts = pgTable("preauth_layouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** Null is the fallback used by any insurer without one of their own. */
  insurerId: uuid("insurer_id").references(() => insurers.id, {
    onDelete: "cascade",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const preauthSections = pgTable(
  "preauth_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    layoutId: uuid("layout_id")
      .notNull()
      .references(() => preauthLayouts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    /** 1 or 2. A pre-auth form is mostly short fields. */
    columnCount: integer("column_count").notNull().default(1),
  },
  (table) => [index("preauth_sections_layout_idx").on(table.layoutId)],
);

export const preauthPlacements = pgTable(
  "preauth_placements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => preauthSections.id, { onDelete: "cascade" }),
    fieldDefinitionId: uuid("field_definition_id")
      .notNull()
      .references(() => preauthFieldDefinitions.id, { onDelete: "cascade" }),
    displayOrder: integer("display_order").notNull().default(0),
    /** Meaningless in a single-column section, hence 0 rather than null. */
    columnPosition: integer("column_position").notNull().default(0),
    labelOverride: text("label_override"),
    required: boolean("required").notNull().default(false),
  },
  (table) => [
    index("preauth_placements_section_idx").on(table.sectionId),
    unique().on(table.sectionId, table.fieldDefinitionId),
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
    /**
     * One of SummarisationStatus — see migration 0035.
     *
     * `summarisedBy` says who wrote what is there; this says whether the
     * model was asked and what came back. A null summary with a
     * 'failed' status is a retry waiting to happen; the same null with
     * 'not_attempted' is just a query nobody ran the model on.
     */
    summarisationStatus: text("summarisation_status")
      .notNull()
      .default("not_attempted"),
    deadline: timestamp("deadline", { withTimezone: true }),
    /** True when the deadline was read out of the email rather than entered. */
    deadlineInferred: boolean("deadline_inferred").notNull().default(false),
    /**
     * The confirm step adr 0005 requires, for the one summariser output
     * that lands in an operational column rather than a suggestion one.
     *
     * Deliberately two axes, not one: `deadlineInferred` is *how* the
     * value was arrived at and never changes, this is *whether a human
     * has vouched for it*. A desk exec who types the deadline himself
     * gets both at once — set by him, confirmed by him. The summariser
     * only ever gets the first.
     */
    deadlineConfirmedBy: uuid("deadline_confirmed_by").references(
      () => members.id,
    ),
    deadlineConfirmedAt: timestamp("deadline_confirmed_at", {
      withTimezone: true,
    }),
    replySentAt: timestamp("reply_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("queries_claim_id_idx").on(table.claimId)],
);

/**
 * A request to raise the sanctioned amount mid-treatment, because the
 * actual cost outgrew what the insurer authorised.
 *
 * Its own table rather than a claim column, because docs/adr/0004 is
 * right that this is a workflow and not a flag: it has its own money
 * (how much more was asked for, how much more was granted), its own
 * outcome, and its own clock. A hospital that asked for ₹80,000 more
 * and was given ₹50,000 needs both numbers afterwards to know where the
 * shortfall came from — a single column would have kept neither.
 *
 * One claim can need several over a long admission, so nothing here
 * assumes a single row. See docs/adr/0012.
 */
export const enhancements = pgTable(
  "enhancements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    /** What was asked for, over and above the amount already sanctioned. */
    requestedAmount: numeric("requested_amount", {
      precision: 12,
      scale: 2,
    }).notNull(),
    /** Why the cost grew — goes to the insurer, so it's required, not a note. */
    reason: text("reason").notNull(),
    status: enhancementStatus("status").notNull().default("REQUESTED"),
    /**
     * What the insurer actually added. Null while open; on a partial
     * approval it is less than `requestedAmount`, and the gap between
     * the two is the shortfall this claim will end in.
     */
    approvedAmount: numeric("approved_amount", { precision: 12, scale: 2 }),
    /** Stamped server-side when the request goes out — same rule as claim SLAs (docs/adr/0004). */
    slaDeadline: timestamp("sla_deadline", { withTimezone: true }),
    requestedBy: uuid("requested_by").references(() => members.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("enhancements_claim_id_idx").on(table.claimId)],
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
    requestedBy: uuid("requested_by").references(() => members.id),
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
    /**
     * Where the appeal stands. Deductions were write-once until
     * docs/adr/0013: knowing what was cut is only worth money if
     * something can be done about it, and contesting one is the
     * something.
     */
    appealStatus: deductionAppealStatus("appeal_status")
      .notNull()
      .default("NOT_CONTESTED"),
    /**
     * What the insurer actually gave back. Null until resolved; zero is
     * a real and different answer from null — it means the appeal was
     * fought and lost, which is what stops the desk appealing the same
     * reason to the same insurer forever.
     */
    recoveredAmount: numeric("recovered_amount", { precision: 12, scale: 2 }),
    contestedAt: timestamp("contested_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** How the appeal was argued, and what came back. */
    appealNote: text("appeal_note"),
    recordedBy: uuid("recorded_by").references(() => members.id),
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
    actorId: uuid("actor_id").references(() => members.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("audit_log_created_at_idx").on(table.createdAt)],
);

/**
 * A file dropped into the assistant before anyone knows which claim it
 * belongs to.
 *
 * `documents` hang off a claim, and can't exist without one. These
 * can't have one yet, which is the entire point: a desk holding a
 * ward's worth of scans doesn't know the claim for each, and making
 * them pick one before they can upload is the work the assistant
 * exists to remove.
 *
 * A row lives here until a human approves a filing. At that moment the
 * object moves under the claim's prefix and becomes an ordinary
 * `documents` row — `filed_document_id` is the join back, so an
 * attachment that was never filed stays visible as exactly that rather
 * than disappearing.
 */
export const assistantAttachments = pgTable(
  "assistant_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Staging key, until filing moves it. */
    fileUrl: text("file_url").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => members.id),
    /**
     * What the recogniser made of it. Suggestions, in suggestion
     * columns, exactly as `documents` keeps them (docs/adr/0005) —
     * nothing here places a file anywhere.
     */
    suggestedClaimId: uuid("suggested_claim_id").references(() => claims.id, {
      onDelete: "set null",
    }),
    suggestedSlot: text("suggested_slot"),
    claimConfidence: numeric("claim_confidence", { precision: 4, scale: 3 }),
    slotConfidence: numeric("slot_confidence", { precision: 4, scale: 3 }),
    /** What in the document identified the patient. Shown before approval. */
    recognitionReason: text("recognition_reason"),
    /** Mean Textract confidence, when the file was one OCR could read. */
    ocrConfidence: numeric("ocr_confidence", { precision: 4, scale: 3 }),
    /**
     * SHA-256 of the bytes, so the same file dropped twice is known to
     * be the same file rather than reasoned about.
     *
     * Only attachments carry this. A document uploaded through a claim
     * page has no hash, which is why the duplicate check also compares
     * filenames against the matched claim — a weaker signal, but the
     * only one available for files that never came through here.
     */
    contentHash: text("content_hash"),
    /** Set when a human approved; the document row this became. */
    filedDocumentId: uuid("filed_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    filedAt: timestamp("filed_at", { withTimezone: true }),
    /** Set when a human threw it away instead. */
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("assistant_attachments_uploaded_by_idx").on(table.uploadedBy),
  ],
);

/**
 * One conversation with the desk assistant.
 *
 * The chat used to live only in the browser and die with the tab, which
 * was right while it was a toy and wrong the moment people started
 * relying on it: "what did it tell me about this claim yesterday" is a
 * fair question, and an answer that only ever existed in a closed tab
 * is not an answer.
 *
 * Two jsonb columns doing two different jobs, deliberately:
 *
 * - `turns` is the record — what was said, in the shape the panel
 *   renders. It is the thing a person comes back to read.
 * - `transcript` is machinery — the provider's own message blocks,
 *   carried so a conversation can be continued, never parsed by
 *   anything here (docs/adr/0017).
 *
 * Deriving one from the other would couple what a human reads to
 * someone else's wire format, and that format changing is not a reason
 * for last month's conversations to stop rendering.
 */
export const assistantConversations = pgTable(
  "assistant_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id").references(() => members.id),
    /** The opening message, truncated — what the history list shows. */
    title: text("title").notNull(),
    turns: jsonb("turns")
      .notNull()
      .default(sql`'[]'::jsonb`),
    /**
     * Which of this conversation's proposals have been acted on, keyed
     * by the tool_use id the card already carries.
     *
     * Only approvals are recorded. "Not now" is not spent — it is a
     * decision to leave the card alone, and a conversation reopened
     * next week should still offer it. An approval is the one that
     * cannot be taken twice, and replaying a filed document's card as
     * though it were live is how a desk learns to distrust the panel.
     */
    resolvedProposals: jsonb("resolved_proposals")
      .notNull()
      .default(sql`'{}'::jsonb`),
    transcript: jsonb("transcript")
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("assistant_conversations_member_idx").on(
      table.memberId,
      table.updatedAt,
    ),
  ],
);

/**
 * Modules a hospital defines for itself — see migration 0034.
 *
 * Fields are a table; a record's answers are one jsonb column. Those
 * are opposite decisions on purpose. Fields are referenced by key from
 * stored data and need stable ids, so they are rows. A record's shape
 * isn't known until a desk invents the module, so it is JSON.
 */
export const customModules = pgTable("custom_modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  pluralName: text("plural_name").notNull(),
  /** The URL segment. Stored, so renaming the module keeps its address. */
  slug: text("slug").notNull().unique(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const customModuleFields = pgTable(
  "custom_module_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => customModules.id, { onDelete: "cascade" }),
    /** Stable: records are keyed on this, so a renamed label never moves data. */
    fieldKey: text("field_key").notNull(),
    label: text("label").notNull(),
    /** One of LayoutFieldType — the same registry the pre-auth builder uses. */
    fieldType: text("field_type").notNull(),
    required: boolean("required").notNull().default(false),
    options: jsonb("options").$type<string[]>(),
    helpText: text("help_text"),
    showInList: boolean("show_in_list").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_custom_module_fields_module").on(table.moduleId),
    unique("custom_module_fields_key_unique").on(
      table.moduleId,
      table.fieldKey,
    ),
  ],
);

export const customModuleRecords = pgTable(
  "custom_module_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => customModules.id, { onDelete: "cascade" }),
    data: jsonb("data")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid("created_by").references(() => members.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_custom_module_records_module").on(
      table.moduleId,
      table.createdAt,
    ),
  ],
);
