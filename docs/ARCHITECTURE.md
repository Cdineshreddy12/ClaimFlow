# Architecture

ClaimFlow is a single hospital's own insurance claims desk — one
deployment per hospital, not a shared multi-tenant install. Sizing comes
from the pilot hospital — a 180-bed multispecialty hospital with a
9-person insurance desk, ~650 cashless admissions/month across 20+
insurers and TPAs — but nothing about that hospital is baked into the
schema: the next hospital gets its own deployment through the same
self-serve setup, not a row in a shared table.

That's a change from the original design. ClaimFlow started multi-tenant,
with every hospital an `organization` row isolated from every other; it
was rebuilt single-tenant at the client's request on 2026-11-04. See
[`0002-authorization-and-tenant-isolation.md`](adr/0002-authorization-and-tenant-isolation.md)
for the reasoning on both sides of that change.

## Stack

| Layer        | Choice                                                                                     | Why                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Frontend     | React + Vite + TypeScript, Tailwind, Zustand (UI state) + TanStack Query (server state)    | Fast to build a clean, minimal UI; Zustand/TanStack split keeps server-state caching out of a client-state store |
| Backend      | Fastify (Node.js, TypeScript)                                                              | Lightweight, plugin-based, good fit for a module-per-domain API                                                  |
| Database     | Supabase-hosted Postgres + Drizzle ORM                                                     | Managed Postgres hosting; Drizzle for type-safe schema, queries, and migrations from the API                     |
| File storage | AWS S3 (Mumbai region)                                                                     | Scanned documents and merged PDF packets never live in the database                                              |
| AI           | Claude (classification, field extraction, query summarization) + OCR for handwritten notes | Structured extraction with citations maps directly to the human-confirm UX requirement                           |
| Billing      | Razorpay Subscriptions — decided, not yet wired up                                         | GST-compliant invoicing for Indian hospital finance teams, once a subscription exists to bill                    |

## Repository layout

```
apps/
  web/     React app. Feature-based: src/features/*, one directory per
           domain — claims, checklist, documents, queries, assistant,
           doctor-approval, reports, hospital, onboarding, and more
  api/     Fastify app. Domain modules: src/modules/*, same split —
           claims, checklist, documents, queries, assistant,
           doctor-approval, enhancements, deductions, reports, sla,
           onboarding, hospital, custom-modules, and more, one module
           per domain, no workers tier (see Document processing below)
           src/integrations/ (storage, ocr, classifier, preauth
           extraction, summariser, assistant, recogniser — the external
           calls, one directory per capability)
           src/db/ (Drizzle schema, migrations, seed)
packages/
  contracts/  Zod schemas shared by both apps — API request/response shapes,
              NOT 1:1 with DB models. Internal/sensitive fields never cross
              this boundary into the frontend.
supabase/     Auth/Studio config only (local dev) — schema lives in apps/api/src/db/
docs/adr/     Short decision records for the handful of genuinely hard calls
```

## One hospital, one install

There's no tenant column on any table. `hospital_profile` holds this
install's single hospital — name, ROHINI id, registration, GSTIN,
address, desk contact — as exactly one row, enforced by a unique index
on a constant expression rather than by convention; a cashless desk
can't send a pre-auth or build a packet without it.

`insurers` and `procedures` are still a shared reference catalog — the
same insurer is the same real-world entity regardless of which hospital
runs this install — but `checklist_rules` belongs to this hospital
alone, since what it requires from an insurer is its own call.

**Read this before touching the API's database access:**
[`0002-authorization-and-tenant-isolation.md`](adr/0002-authorization-and-tenant-isolation.md)
covers how access is actually controlled — role, and only role, checked
by Fastify middleware — and why RLS policies in the schema don't protect
the API on their own: the API connects to Postgres via Drizzle as the
`postgres` superuser, which bypasses RLS unconditionally. See
[`0007-onboarding-flow.md`](adr/0007-onboarding-flow.md) for how a
hospital sets itself up, and
[`0006-billing-and-onboarding.md`](adr/0006-billing-and-onboarding.md)
for the billing decision that isn't wired up yet.

## The hard part: checklist rules

Each (insurer, procedure) pair has its own required-document list, set by the
desk head. A claim's gap view is `required − present`, computed live — never
stored. Checklist rules are **versioned**: editing a rule only affects claims
opened after the edit, so an in-flight claim's requirements never shift
underneath the desk exec working it. See
[`0001-checklist-engine.md`](adr/0001-checklist-engine.md).

## Document processing pipeline

Upload runs inline, not as a background job:

```
Upload API → validate + store (S3) → OCR → AI classify → match to
checklist slot, all within the request → human confirms/corrects →
claim completeness recalculated
```

That's a deliberate choice, not an oversight: today it's one document at
a time with a desk exec watching the upload, so the latency of an S3
write, a Textract call and a model call is acceptable. A Postgres-native
queue (no Redis) is reserved for the first feature that processes
documents unattended or in bulk — bulk upload, a re-classify-everything
admin action — and isn't built until one of those actually ships. See
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
and interaction reference the real screens were built against. The repo's
`docs/screenshots/` directory has what actually shipped, captured from the
live deployment.
