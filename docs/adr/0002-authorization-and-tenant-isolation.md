# 0002 — Authorization and tenant isolation

## Context

ClaimFlow is a multi-tenant SaaS: multiple hospitals, each with their own
staff, insurers-in-use, and checklist configuration, on one shared
deployment. Patient records are sensitive personal data under India's DPDP
Act 2023 — cross-tenant data leakage here isn't a bug, it's an incident.
Company A (Nashik) is the pilot tenant, not a hardcoded assumption baked
into the schema.

## Decision

Every tenant-scoped table (`claims`, `checklist_rules`, `documents`,
`queries`, `audit_log`, `org_members`) carries `organization_id`. Two
independent authorization layers enforce the boundary, and neither is
trusted alone:

1. **Fastify RBAC** — a route-level guard checks the requesting user's role
   and `organization_id` (from a JWT claim) before any handler runs. This is
   also where within-org role filtering lives (e.g. `desk_executive` sees
   only claims where `assigned_to = self`; `desk_head` sees all claims in
   the org) — RLS below only enforces the _tenant_ boundary, not the
   _role_ boundary.
2. **Supabase Row-Level Security** — every tenant-scoped table has a policy
   keyed on `organization_id` matched against `public.organization_id()`, a
   helper reading a custom JWT claim. It lives in `public`, not `auth` —
   Supabase reserves the `auth` schema from project-level `CREATE`, which
   `apps/api/src/db/migrations/0001_row_level_security.sql`'s header
   explains (found by actually running the migration, not guessed).

`organization_id` and `role` are delivered as custom JWT claims via a
Supabase Auth Hook at sign-in, so RLS policies don't need a join/subquery
per row check.

**Critical caveat, and it's not hypothetical — it's how this API actually
connects:** the Fastify API talks to Postgres through **Drizzle ORM** over
a direct connection authenticated as the `postgres` superuser
(`DATABASE_URL`, see `.env.example` and `apps/api/src/db/client.ts`).
**Postgres superusers bypass Row-Level Security unconditionally** — not as
an edge case, but as documented Postgres behavior, same as a Supabase
service-role key. This means **RLS enforces nothing on the path this API
actually uses.** The RLS policies in `0001_row_level_security.sql` exist
for any _other_ connection to this database — e.g. if the frontend or a
future integration ever queries Supabase directly via PostgREST with the
anon/authenticated role — but every request that goes through Fastify is
protected by RBAC alone. Do not treat RLS as a second layer for the API
itself; it isn't one, given this connection choice. If that ever needs to
change, the fix is connecting as a non-superuser, non-table-owner role with
`organization_id` set per-session, not adding more RLS policies.

Roles: `platform_admin` (ClaimFlow operator staff, cross-tenant — any access
through this role to a tenant's data is itself an audited break-glass event,
not yet built but required before a second real tenant onboards),
`org_admin` (hospital-side: billing, users, insurer/checklist config),
`desk_head`, `desk_executive`, `doctor` (token-linked, no full login — see
the product brief's phone-link requirement).

## Consequences

- `checklist_rules`, `insurers`, and `procedures` are split deliberately:
  insurers/procedures are shared reference data (not tenant-scoped — the
  same insurer is the same real-world entity everywhere), while
  `checklist_rules` is tenant-scoped, since what Company A requires from an
  insurer may differ from what another hospital requires.
- Onboarding a second hospital is a data-layer operation (new
  `organizations` row + invited `org_members`), not a schema change.
- Billing and self-serve signup are a separate concern — see
  [`0006-billing-and-onboarding.md`](0006-billing-and-onboarding.md).
- Because RLS doesn't protect the API path, **every new route that touches
  a tenant-scoped table must filter by `organization_id` explicitly** in
  its Drizzle query (`where(eq(claims.organizationId, ctx.organizationId))`,
  not "the database will handle it"). This is the one rule a code reviewer
  should check without exception on any PR touching `apps/api/src/modules/*`.
