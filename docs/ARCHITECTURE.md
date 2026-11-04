# Architecture

ClaimFlow is a multi-tenant SaaS for hospital insurance desks — every
hospital that signs up is an `organization`, isolated from every other.
Sizing comes from the pilot tenant — a 180-bed multispecialty hospital
with a 9-person insurance desk, ~650 cashless admissions/month across
20+ insurers and TPAs — but nothing about that tenant is baked in: the
product onboards the next hospital through the same self-serve flow, no
schema change, no per-tenant code.

## Stack

| Layer        | Choice                                                                                     | Why                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Frontend     | React + Vite + TypeScript, Tailwind, Zustand (UI state) + TanStack Query (server state)    | Fast to build a clean, minimal UI; Zustand/TanStack split keeps server-state caching out of a client-state store |
| Backend      | Fastify (Node.js, TypeScript)                                                              | Lightweight, plugin-based, good fit for a module-per-domain API                                                  |
| Database     | Supabase-hosted Postgres + Drizzle ORM                                                     | Managed Postgres hosting; Drizzle for type-safe schema, queries, and migrations from the API                     |
| File storage | AWS S3 (Mumbai region)                                                                     | Scanned documents and merged PDF packets never live in the database                                              |
| AI           | Claude (classification, field extraction, query summarization) + OCR for handwritten notes | Structured extraction with citations maps directly to the human-confirm UX requirement                           |
| Billing      | Razorpay Subscriptions                                                                     | GST-compliant invoicing for Indian hospital finance teams                                                        |

## Repository layout

```
apps/
  web/     React app. Feature-based: src/features/{auth,dashboard,claims,checklist,documents,queries}
  api/     Fastify app. Domain modules: src/modules/{claims,checklist,documents,queries,dashboard,auth,audit}
           plus src/workers/ (async document processing), src/integrations/ (storage, ocr, ai, email),
           and src/db/ (Drizzle schema, migrations, seed — see Tenancy below)
packages/
  contracts/  Zod schemas shared by both apps — API request/response shapes,
              NOT 1:1 with DB models. Internal/sensitive fields never cross
              this boundary into the frontend.
supabase/     Auth/Studio config only (local dev) — schema lives in apps/api/src/db/
docs/adr/     Short decision records for the handful of genuinely hard calls
```

## Tenancy

Every tenant-scoped table carries `organization_id`
(`apps/api/src/db/schema.ts`, migrated via Drizzle Kit —
`apps/api/src/db/migrations/`). `insurers` and `procedures` are shared
reference data — the same insurer is the same real-world entity for every
hospital — but `checklist_rules` is per-organization, since what each
hospital requires from that insurer can differ.

**Read this before touching the API's database access:**
[`0002-authorization-and-tenant-isolation.md`](adr/0002-authorization-and-tenant-isolation.md)
covers how the tenant boundary is actually enforced — and it is _not_ Row-Level
Security, despite RLS policies existing in the schema. The API connects to
Postgres via Drizzle as the `postgres` superuser, which bypasses RLS
unconditionally; every tenant-scoped query in `apps/api/src/modules/*` must
filter by `organization_id` explicitly. See
[`0006-billing-and-onboarding.md`](adr/0006-billing-and-onboarding.md) for
how a hospital gets onboarded and billed.

## The hard part: checklist rules

Each (insurer, procedure) pair has its own required-document list, set by the
desk head. A claim's gap view is `required − present`, computed live — never
stored. Checklist rules are **versioned**: editing a rule only affects claims
opened after the edit, so an in-flight claim's requirements never shift
underneath the desk exec working it. See
[`0001-checklist-engine.md`](adr/0001-checklist-engine.md).

## Document processing pipeline

Upload is never a single synchronous request:

```
Upload API → validate + store (S3) → background job: OCR → AI classify →
match to checklist slot → human confirms/corrects → claim completeness recalculated
```

Processing is idempotent and retry-tracked via a Postgres-native job queue
(no Redis) — a failed AI call never requires re-uploading the document. See
[`0003-document-processing-pipeline.md`](adr/0003-document-processing-pipeline.md).

## Authorization

Fastify route-level RBAC (`platform_admin` / `org_admin` / `desk_head` /
`desk_executive` / `doctor`) is the **enforced** boundary for the API.
RLS policies exist in the schema but do not protect the API's own
connection — see
[`0002-authorization-and-tenant-isolation.md`](adr/0002-authorization-and-tenant-isolation.md)
for exactly why, before assuming otherwise.

## AI confirmation UX

Every AI-filled field shows its source snippet and stays unconfirmed until a
human clicks it. Misclassified documents are draggable to the correct slot.
Query summaries always render the original email below them. Nothing is ever
sent to an insurer or TPA automatically. See
[`0005-ai-human-confirmation.md`](adr/0005-ai-human-confirmation.md).

## Design reference

[`docs/design/claims-desk-mockup.html`](design/claims-desk-mockup.html) is a
reviewed, critiqued, and fixed static mockup of four of the eight core
screens (Dashboard, Claim File, Query Inbox, Checklist Admin) — the visual
and interaction reference for building the real screens against.
