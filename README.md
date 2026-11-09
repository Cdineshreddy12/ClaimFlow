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
- [Screenshots](#screenshots)
- [Status](#status)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Getting started](#getting-started)
- [Database](#database)
- [Scripts](#scripts)
- [Environment variables](#environment-variables)
- [Security model](#security-model)
- [What's not built yet](#whats-not-built-yet)
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

## Screenshots

Captured from the live deployment, signed in as Org Admin, against the
seeded demo data — not mockups.

|                                                                         |                                                                         |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Dashboard** — KPIs, the overdue queue, and what needs attention today | **Claim File** — status timeline, document gap view, "what now" actions |
| ![Dashboard](docs/screenshots/dashboard.jpg)                            | ![Claim File](docs/screenshots/claim-file.jpg)                          |
| **Claims list** — sortable, filterable, time-in-stage per claim         | **Query Inbox** — a TPA's email with the AI summary and reply countdown |
| ![Claims list](docs/screenshots/claims-list.jpg)                        | ![Query Inbox](docs/screenshots/query-inbox.jpg)                        |
| **Turnaround** — every claim waiting on an insurer, oldest first        | **Receivables** — outstanding by age bucket and by insurer              |
| ![Turnaround](docs/screenshots/turnaround.jpg)                          | ![Receivables](docs/screenshots/receivables.jpg)                        |
| **Checklist Admin** — per insurer × procedure document rules            | **Monthly Report** — turnaround, deductions by reason, settled value    |
| ![Checklist Admin](docs/screenshots/checklist-admin.jpg)                | ![Reports](docs/screenshots/reports.jpg)                                |

Phone layout — same screens, stacked nav behind a hamburger menu:

<p>
  <img src="docs/screenshots/dashboard-mobile.jpg" alt="Dashboard on mobile" width="280" />
  <img src="docs/screenshots/claim-file-mobile.jpg" alt="Claim File on mobile" width="280" />
</p>

### Claim lifecycle

The Claim File above was mid-way through (Final bill). Same screen, three
more points in the same state machine:

|                                                                                             |                                                                                                        |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Draft** — before pre-auth is even sent; empty timeline, "Expected cost" instead of billed | **Rejected** — its own banner and action set, with deduction risk flagged against this payer's history |
| ![Claim in Draft stage](docs/screenshots/claim-stage-draft.jpg)                             | ![Claim in Rejected stage](docs/screenshots/claim-stage-rejected.jpg)                                  |

**Settled** — the timeline closed out end to end, billed and received reconciled:

![Claim in Settled stage](docs/screenshots/claim-stage-settled.jpg)

### Custom forms & modules

A hospital isn't limited to what ships in the box. Checklist Admin lets an
org admin extend both the pre-auth form and the schema itself, per
insurer, without a code change:

|                                                                                                                 |                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Pre-auth form builder** — drag fields (text, date, amount, file upload…) into sections, shared or per-insurer | **Custom modules** — add a table the product doesn't ship, like a ward-round log, each with its own page and form |
| ![Custom pre-auth form builder](docs/screenshots/custom-preauth-form-builder.jpg)                               | ![Custom modules admin](docs/screenshots/custom-modules-admin.jpg)                                                |

**Ward rounds** — one such module in actual use, its own nav entry, route, and CRUD — not a mockup of the idea:

![Ward rounds custom module](docs/screenshots/custom-module-ward-rounds.jpg)

### AI in action

Four places Claude actually runs, including what happens when it's
unsure or catches something wrong — not screenshots of a happy path only.

|                                                                                                                                      |                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Desk assistant** — asked a real question, reads live claim data to answer it                                                       | **Document classification** — confidence per file, and two that got no claim match                                                                     |
| ![Desk assistant answering a question](docs/screenshots/ai-desk-assistant.jpg)                                                       | ![Document classification confidence and abstentions](docs/screenshots/ai-document-classification.jpg)                                                 |
| **Pre-auth consistency check** — flags a named surgery whose line of treatment doesn't match, before the desk sends it to an insurer | **Checklist rules learned from queries** — an insurer kept asking for a document the checklist didn't require; the system noticed and offers to add it |
| ![Pre-auth form consistency check catching a mismatch](docs/screenshots/ai-preauth-consistency-check.jpg)                            | ![Checklist rule suggested from repeated TPA queries](docs/screenshots/ai-checklist-learned-rules.jpg)                                                 |

## Status

**Everything below runs end-to-end against the live API, a real Supabase
Postgres database, and a real S3 bucket — not mocked, and not just styled.**

- **Auth & RBAC** — Supabase JWT verification with a Custom Access Token
  hook that stamps `organization_id`/role onto the token. Three roles
  (org_admin, desk_head, desk_executive), enforced in Fastify middleware
  on every route — not just hidden in the UI.
- **Claims** — one file per admission, a status timeline bound to the
  shared state machine, desk executives scoped to their own assigned
  claims.
- **Checklist engine** — rules are per insurer × procedure and versioned:
  editing a rule only affects claims opened after the edit, so an
  in-flight claim's requirements never shift underneath the desk
  ([`adr 0001`](docs/adr/0001-checklist-engine.md)).
- **Documents** — pre-signed S3 upload, a live gap view (required minus
  confirmed), and AI classification: Claude reads the document itself,
  returns a confidence and the evidence behind it, and a human clicks
  Confirm before anything counts. No `ANTHROPIC_API_KEY`? Falls back to
  filename matching and says so in the UI rather than pretending a model
  ran ([`adr 0003`](docs/adr/0003-document-processing-pipeline.md)).
- **Pre-auth form** — Claude extracts the ~25 required fields from
  uploaded documents; a separate consistency check reads the confirmed
  fields against each other (dates out of order, an estimate that
  doesn't add up, a named surgery whose line of treatment doesn't
  match) and flags what's worth a second look rather than silently
  accepting it.
- **Query inbox** — Claude summarizes a pasted TPA email into what's
  wanted and by when; the deadline only counts once a human confirms
  it, and the original email stays visible underneath the summary
  ([`adr 0005`](docs/adr/0005-ai-human-confirmation.md)).
- **Desk assistant** — a floating panel that reads scattered uploads
  with no claim attached, works out which claim and slot each belongs
  to, and answers questions about the desk (turnaround, deductions,
  what's overdue). It proposes; every write waits on a human's click
  ([`adr 0017`](docs/adr/0017-desk-assistant.md)).
- **Doctor approval links** — a desk mints a 48-hour, one-decision link
  for a named doctor with no account, payload narrowed to confirmed
  clinical documents only ([`adr 0010`](docs/adr/0010-doctor-approval-links.md)).
- **Reports** — a merged PDF packet per claim, deductions by reason on
  the dashboard, and a monthly period report for the person who signs
  the deal but never logs in.
- **Audit log** — every mutation writes a who/what/when entry; deltas
  only, no write route, gated to org_admin/desk_head
  ([`adr 0009`](docs/adr/0009-audit-logging.md)).

Covered by unit tests and integration tests against the real database —
see [Scripts](#scripts). For what's deliberately not built yet, see
[What's not built yet](#whats-not-built-yet).

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

## What's not built yet

- **Razorpay billing.** Self-serve organization signup, a hospital
  profile, and a 14-day trial all exist
  ([`adr 0007`](docs/adr/0007-onboarding-flow.md)); charging a card at
  the end of the trial does not.
- **A platform super-admin console** with audited break-glass access —
  today, support work on a stuck tenant means a direct database query,
  not a screen.
- **OCR confidence isn't surfaced separately from classification
  confidence** — Textract feeds the classifier, but a desk can't yet
  tell "the scan was blurry" apart from "the document type is unclear."

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system overview, stack, module map
- [`docs/adr/`](docs/adr) — decision records (checklist engine, tenant isolation, document pipeline, claim state machine, AI confirmation UX, billing, onboarding flow, audit logging, doctor approval links)
- [`docs/design/claims-desk-mockup.html`](docs/design/claims-desk-mockup.html) — reviewed UI reference

## License

Proprietary — all rights reserved. Not licensed for reuse, redistribution,
or modification outside this project.
