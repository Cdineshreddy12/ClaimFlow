# 0002 — Authorization

**Superseded in part, 2026-11-04: ClaimFlow is single-tenant.** The
original decision below described a multi-tenant SaaS with an
`organization_id` on every table. That was removed at the client's
request — one deployment per hospital. The superseding decision is
recorded first; the original is kept underneath because the reasoning
about RLS and superuser connections survives the change and is still the
thing most likely to be got wrong.

## Decision (current)

**One install, one hospital.** There is no tenant column on any table.
`hospital_profile` holds the single hospital's identity — name, ROHINI
id, registration, GSTIN, address, desk contact — as exactly one row,
enforced by a unique index on a constant expression rather than by
convention. That table is identity, not tenancy: a cashless desk cannot
send a pre-auth or a packet without it.

**Authorization is role, and only role.** `members` maps a Supabase auth
user to one of `platform_admin`, `org_admin`, `desk_head`,
`desk_executive`, `doctor`. The Custom Access Token hook stamps the role
onto the JWT at sign-in; `authenticate` is the only place that claim is
trusted, and `requireRole` is the boundary. Within-role scoping is
unchanged and still matters: a `desk_executive` sees claims where
`assigned_to = self`, a `desk_head` sees all of them.

**RLS policies are now `auth.role() = 'authenticated'`.** The question
they used to answer — "is this row yours?" — no longer exists, because
everyone signed in belongs to the same hospital. They remain enabled so
that a non-superuser connection is not wide open by default.

**What this removes.** The whole class of cross-tenant leakage is gone
along with the column, which is the honest upside. What replaces it as
the thing to get right is narrower: role filtering, and the fact that a
bare `claimId` from a URL is now authorization-free. Any route taking a
claim id must still go through the service layer so `assigned_to`
scoping applies — a repository call with a raw id from `request.params`
will happily return another desk executive's claim.

The cross-tenant isolation tests were deleted rather than weakened. A
test that asserts a boundary which no longer exists passes for the wrong
reason and tells a future reader the boundary is still there.

### One migration note worth keeping

`0014_auth_hook_permissions.sql` fixes a latent bug in `0002`'s hook:
it was created `SECURITY INVOKER`, so Supabase runs it as
`supabase_auth_admin` — a role that is not a superuser, does not have
`BYPASSRLS`, and had no `SELECT` grant on the membership table. Every
real sign-in failed with `Error running hook URI: pg-functions://…`. It
went unnoticed for weeks because local development authenticates with
`VITE_DEV_TOKEN`, which skips Supabase sign-in entirely — the hook is
only reached by an actual login. Both a `GRANT` and an RLS policy for
that role are required; the grant alone is not enough while RLS is on.

---

## Original decision (multi-tenant) — historical

### Context

ClaimFlow is a multi-tenant SaaS: multiple hospitals, each with their own
staff, insurers-in-use, and checklist configuration, on one shared
deployment. Patient records are sensitive personal data under India's DPDP
Act 2023 — cross-tenant data leakage here isn't a bug, it's an incident.
The pilot hospital is simply the first tenant, not a hardcoded assumption
baked into the schema.

### Decision

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
   helper reading a custom JWT claim.

**Critical caveat, and it's not hypothetical — it's how this API actually
connects:** the Fastify API talks to Postgres through **Drizzle ORM** over
a direct connection authenticated as the `postgres` superuser
(`DATABASE_URL`, see `.env.example` and `apps/api/src/db/client.ts`).
**Postgres superusers bypass Row-Level Security unconditionally** — not as
an edge case, but as documented Postgres behavior, same as a Supabase
service-role key. This means **RLS enforces nothing on the path this API
actually uses.** The RLS policies exist for any _other_ connection to this
database — e.g. if the frontend or a future integration ever queries
Supabase directly via PostgREST with the anon/authenticated role — but
every request that goes through Fastify is protected by RBAC alone.

**This caveat still holds, and still matters.** It is the reason the
single-tenant policies above are `auth.role() = 'authenticated'` rather
than something more elaborate: elaborating them would be theatre on a
connection that bypasses them anyway.

### Consequences (historical)

- `checklist_rules`, `insurers`, and `procedures` were split deliberately:
  insurers/procedures are shared reference data, while `checklist_rules`
  was tenant-scoped. After the single-tenant change `checklist_rules` is
  simply the hospital's own configuration, unique per
  (insurer, procedure, document type).
- Onboarding a second hospital was a data-layer operation. It is now a
  second deployment.
