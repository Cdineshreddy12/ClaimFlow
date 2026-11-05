<div align="center">

# ClaimFlow

**Multi-tenant SaaS for hospital insurance claims desks.**

[![CI](https://github.com/Cdineshreddy12/ClaimFlow/actions/workflows/ci.yml/badge.svg)](https://github.com/Cdineshreddy12/ClaimFlow/actions/workflows/ci.yml) ![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white) ![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white) ![License](https://img.shields.io/badge/license-proprietary-lightgrey)

[Architecture](docs/ARCHITECTURE.md) · [Decision records](docs/adr) · [Design mockup](docs/design/claims-desk-mockup.html)

</div>

---

## Table of contents

- [The problem](#the-problem)
- [What ClaimFlow does](#what-claimflow-does)
- [Status](#status)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Getting started](#getting-started)
- [Database](#database)
- [Scripts](#scripts)
- [Environment variables](#environment-variables)
- [Security model](#security-model)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [License](#license)

## The problem

A hospital's insurance desk handles cashless admissions across 20+ insurers
and TPAs, each with its own document format. Today that means typing
pre-authorization forms, scanning doctors' notes, emailing them out,
tracking status in spreadsheets, and chasing queries and doctors over
email and WhatsApp. Hospitals lose money to avoidable deductions —
documents missing at submission, not treatment errors — and patients wait
longer than necessary for discharge approval while the desk tracks
everything by hand.

## What ClaimFlow does

- **One claim file per admission** with a live status timeline (pre-auth →
  query/enhancement → approved → final bill → settled).
- **A checklist of what's missing**, configured per insurer and procedure
  by the hospital's own admin, computed live — never stale.
- **AI-assisted document sorting and field pre-fill** — every AI result
  shows its source and stays unconfirmed until a human clicks it.
  Misclassified documents are draggable to the right slot. Nothing is
  ever sent to an insurer or TPA automatically.
- **A query inbox** that summarizes what a TPA wants and by when, with the
  original email always visible underneath the summary.
- **Multi-tenant from the ground up** — every hospital that signs up is an
  isolated organization on one shared deployment, not a one-off install.

## Status

**Architecture and schema are real and live; feature modules are next.**

- ✅ Multi-tenant Postgres schema, migrated via Drizzle ORM and verified
  against a real Supabase project (10 tables, 20 RLS policies, seeded
  with the pilot tenant's sample data).
- ✅ Workspace scaffold (`apps/web`, `apps/api`, `packages/contracts`)
  typechecks, lints, tests, and builds clean in CI.
- ✅ System architecture and six decision records written for the hard
  calls: the checklist rules engine, tenant isolation, async document
  processing, the claim state machine, AI confirmation UX, and billing.
- ✅ Four of eight core screens have a reviewed, critiqued, and
  accessibility-fixed design mockup.
- ✅ Auth: Supabase JWT verification + a Custom Access Token hook that
  stamps organization_id/role onto the token, RBAC middleware, enforced
  on every claims route.
- ✅ Claims module (API): list/get/create, status transitions enforced
  against the shared state machine, desk_executive scoped to their own
  assigned claims.
- ✅ Checklist module (API): rules CRUD, gated to org_admin/desk_head.
  Claim creation now actually snapshots the live rules onto the claim.
- ✅ Documents module (API): pre-signed S3 upload, human-confirm into a
  checklist slot, discard, and a live gap-view endpoint (required docs
  minus confirmed ones). AI auto-classification isn't wired up yet — no
  provider credentials exist for it (see docs/adr/0003) — so every
  document is confirmed into a slot manually for now.
- ✅ Query inbox module (API): log a TPA query against a claim, an
  org-wide inbox listing (open/replied/all, same desk_executive scoping
  as claims), and reply tracking. No AI summarizer wired up yet either —
  same boundary as documents — so the summary/requested items are
  entered by hand for now; the original email is the source of truth
  either way per docs/adr/0005.
- ✅ Web app: Claim File, Dashboard, and Query Inbox screens wired
  end-to-end against the live API. Claim File has the status timeline,
  live document-gap view, and a real upload flow (the browser PUTs
  straight to S3, same pre-signed-URL path as the API). Dashboard has
  real kpis, a claims-by-status breakdown, and the claims table — deductions by reason is now real (see below); avg discharge wait
  still has no backing data, so open/overdue queries stands in rather
  than being faked. Query Inbox
  lists open TPA queries with a live reply-window countdown and marks
  a reply sent for real (docs/adr/0005 — nothing is ever auto-sent, and
  no reply body is stored, only the timestamp); whether a requested
  document "looks attached" is a best-effort match against the claim's
  confirmed checklist slots, not a stored fact, since nothing in the
  schema links a query's requested item to a specific document. No
  login screen yet, so a dev-only minted token stands in for auth (see
  `.env.example`'s `VITE_DEV_TOKEN`) — swap for real Supabase auth once
  the Custom Access Token hook is enabled.
- ✅ The desk can actually drive all of it from the UI — open a claim,
  advance it through the state machine (only the transitions the API
  allows, derived from the same table it enforces), log a TPA query,
  build the packet, mint a doctor link, record a deduction. Several of
  these had working APIs and no way in from a screen.
- ✅ Document sorting — an upload gets a suggested checklist slot with a
  confidence and the evidence behind it. Claude reads the document
  itself (verified live: a scan named `IMG_0423.png` classified at 98%
  from the image alone, and a cafeteria menu with a misleading clinical
  filename correctly abstained). Nothing is filed automatically:
  the suggestion is pre-selected and a human clicks Confirm, so a slot
  stays missing in the gap view until someone vouches for it. The UI
  names which classifier made the suggestion rather than implying a
  model ran.
- ✅ Deductions by reason — recorded against a claim at settlement and
  aggregated for the dashboard, with the avoidable share (missing or
  late paperwork) called out separately, since that's the number the
  40%-reduction target actually tracks.
- ✅ Doctor approval by phone link — a desk mints a link for a named
  doctor who approves or sends back clinical notes with no account.
  Bounded by 48h expiry, one decision per link, and a payload narrowed
  to confirmed clinical documents only (docs/adr/0010).
- ✅ Merged PDF packet per claim — cover sheet plus every confirmed
  document, type detected by magic number, unembeddable files reported
  rather than dropped.
- ✅ Audit logging — every mutation that creates, changes or destroys
  tenant data writes a who/what/when entry (DPDP constraint, see
  docs/adr/0009). Deltas only, not row dumps; reads gated to
  org_admin/desk_head; no write route, so the trail can't be forged by
  a client. Not yet transactional with the mutation — caveat in the ADR.
- ✅ Checklist Admin screen — pick an insurer × procedure, add/remove
  document requirements and flip each between required and optional.
  Shows how many in-flight claims the pair has, and states plainly that
  edits apply going forward only (verified: adding a live rule leaves an
  open claim's frozen snapshot untouched).
- ✅ Monthly period report — the one screen built for the person who
  signs the deal but never logs in. A desk head picks a closed calendar
  month and gets claim volume, settled value, average turnaround,
  deductions by reason, and insurer turnaround, assembled from the same
  summaries the dashboard and Turnaround page already compute (nothing
  new is calculated), downloadable as a one-page PDF to forward on
  (docs/adr/0018). Gated to org_admin/desk_head, same as Checklist
  Admin — a desk executive's nav doesn't show it and the API 403s a
  direct link.

All of the above is covered by both unit tests and integration tests
against the real Supabase database and the real S3 bucket — not mocked.

## Architecture

```mermaid
flowchart LR
    subgraph Client
        Web["React app<br/>(apps/web)"]
    end

    subgraph Server
        API["Fastify API<br/>(apps/api)"]
        Workers["Async workers<br/>OCR → AI classify → match"]
    end

    subgraph Data
        PG[("Postgres<br/>Supabase, Mumbai")]
        S3[("S3<br/>scanned docs, PDF packets")]
    end

    AI["Claude<br/>classify · extract · summarize"]
    Razorpay["Razorpay<br/>billing"]

    Web -- "HTTPS, RBAC-scoped" --> API
    API -- "Drizzle ORM" --> PG
    API --> S3
    API --> Workers
    Workers --> AI
    Workers --> PG
    API --> Razorpay
```

Every tenant-scoped table carries `organization_id`. Tenant isolation is
enforced in the Fastify route layer, not by database RLS — see
[Security model](#security-model) for exactly why, and
[`docs/adr/0002`](docs/adr/0002-authorization-and-tenant-isolation.md) for
the full reasoning.

## Tech stack

| Layer        | Choice                                                                                    | Why                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Frontend     | React · Vite · TypeScript · Tailwind · Zustand (UI state) · TanStack Query (server state) | Fast to build a clean UI; server-state caching stays out of the client-state store       |
| Backend      | Fastify (Node.js, TypeScript)                                                             | Lightweight, plugin-based, a natural fit for a module-per-domain API                     |
| ORM          | Drizzle ORM + drizzle-kit                                                                 | Type-safe schema, queries, and migrations, generated from one TypeScript source of truth |
| Database     | Supabase-hosted Postgres (Mumbai region)                                                  | DPDP-compliant residency; managed hosting                                                |
| File storage | AWS S3 (Mumbai region)                                                                    | Scanned documents and merged PDF packets never live in the database                      |
| AI           | Claude — classification, field extraction, query summarization                            | Structured extraction with citations maps directly to the human-confirm requirement      |
| Billing      | Razorpay Subscriptions                                                                    | GST-compliant invoicing for Indian hospital finance teams                                |

Full rationale for each decision is in [`docs/adr/`](docs/adr).

## Repository structure

```
apps/
  web/            React app — feature-based (src/features/*)
  api/            Fastify app
    src/modules/      Domain modules (claims, checklist, documents, queries, auth, audit)
    src/workers/      Async document processing
    src/integrations/ External services (storage, ocr, ai, email)
    src/db/           Drizzle schema, migrations, seed
packages/
  contracts/      Zod schemas shared by both apps — API shapes, not DB models
supabase/         Auth/Studio config for local dev (schema lives in apps/api/src/db/)
docs/
  ARCHITECTURE.md
  adr/            Decision records for the hard calls
  design/         Reviewed UI mockup
```

## Getting started

```bash
pnpm install
cp .env.example .env   # fill in Supabase / S3 / Anthropic / Razorpay keys
pnpm dev                # runs apps/web and apps/api together
```

## Database

Schema lives in `apps/api/src/db/schema.ts`; migrations in
`apps/api/src/db/migrations/`.

```bash
cd apps/api
pnpm db:generate   # generate a migration from schema.ts changes
pnpm db:migrate    # apply pending migrations
pnpm db:seed       # seed the pilot tenant's sample claims
pnpm db:studio     # browse the database
```

## Scripts

| Script           | What it does                |
| ---------------- | --------------------------- |
| `pnpm dev`       | Run all apps in dev mode    |
| `pnpm build`     | Build all apps and packages |
| `pnpm lint`      | Lint the whole workspace    |
| `pnpm typecheck` | Typecheck all workspaces    |
| `pnpm test`      | Run all test suites         |

The API's suites are unit tests plus integration tests that run against
a real Postgres — they skip themselves when `DATABASE_URL` is unset, so
a clone with no database still runs green. The web app's are a mix of
pure-logic tests and component tests (Testing Library on happy-dom,
configured in `apps/web/vitest.config.ts`); components that call the API
mock `lib/api-client` rather than the network.

## Environment variables

See [`.env.example`](.env.example) for the full list with explanations.
Summary:

| Variable                             | Used by            | Notes                                                         |
| ------------------------------------ | ------------------ | ------------------------------------------------------------- |
| `DATABASE_URL`                       | Drizzle (apps/api) | Direct Postgres connection — bypasses RLS, see Security model |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | apps/web, apps/api | Auth                                                          |
| `SUPABASE_SERVICE_ROLE_KEY`          | apps/api           | Admin tooling only — also bypasses RLS                        |
| `AWS_*`                              | apps/api           | S3 storage, Textract OCR                                      |
| `ANTHROPIC_API_KEY`                  | apps/api           | Claude — classification, extraction, summarization, assistant |

## Security model

Patient records are sensitive personal data under India's DPDP Act 2023.
Two things worth stating plainly rather than leaving implicit:

- **RLS policies exist in the schema but do not protect the API.** The API
  connects to Postgres via Drizzle as the `postgres` superuser, and
  Postgres superusers bypass Row-Level Security unconditionally — this is
  documented Postgres behavior, not an oversight. **Fastify RBAC is the
  enforced tenant boundary** for every request; every tenant-scoped query
  in `apps/api/src/modules/*` must filter by `organization_id` explicitly.
  Full detail: [`docs/adr/0002`](docs/adr/0002-authorization-and-tenant-isolation.md).
- **Checklist rules are versioned.** Editing a hospital's checklist only
  affects claims opened after the edit — an in-flight claim's requirements
  never shift underneath the desk executive working it.
  [`docs/adr/0001`](docs/adr/0001-checklist-engine.md).

## Roadmap

- [x] Auth (Supabase JWT + RBAC), claims, checklist, documents, and
      query-inbox modules (API)
- [x] Dashboard, Claim File, and Query Inbox screens (web) — wired to
      the live API, not just styled
- [x] Checklist Admin screen (web) — all four mockup screens now built
- [x] Document classification — Claude when `ANTHROPIC_API_KEY` is set,
      filename heuristic otherwise ([`adr 0003`](docs/adr/0003-document-processing-pipeline.md))
- [x] Query summarisation — Claude reads a pasted TPA email for the
      summary, requested items and deadline. The deadline waits for a
      human's Confirm before it counts as the desk's own
      ([`adr 0005`](docs/adr/0005-ai-human-confirmation.md))
- [x] OCR for handwritten notes (Textract, feeding the classifier)
- [x] Desk assistant — a floating panel on every screen that takes files
      with no claim attached, works out which claim and slot each
      belongs to, and answers questions about the desk. It proposes;
      every write waits on a human's click
      ([`adr 0017`](docs/adr/0017-desk-assistant.md))
- [x] Doctor approval via phone link
- [x] Merged PDF packet per claim
- [x] Deductions by reason, on the dashboard
- [x] Audit logging for every mutation (DPDP)
- [x] Self-serve organization signup, hospital profile, 14-day trial —
      see [`docs/adr/0007`](docs/adr/0007-onboarding-flow.md). Razorpay
      billing itself is still to come.
- [ ] Platform super-admin console with audited break-glass access

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system overview, stack, module map
- [`docs/adr/`](docs/adr) — decision records (checklist engine, tenant isolation, document pipeline, claim state machine, AI confirmation UX, billing, onboarding flow, audit logging, doctor approval links)
- [`docs/design/claims-desk-mockup.html`](docs/design/claims-desk-mockup.html) — reviewed UI reference

## License

Proprietary — all rights reserved. Not licensed for reuse, redistribution,
or modification outside this project.
