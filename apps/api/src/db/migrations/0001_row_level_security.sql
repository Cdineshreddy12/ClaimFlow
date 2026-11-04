-- Row-Level Security policies.
--
-- IMPORTANT — read docs/adr/0002-authorization-and-tenant-isolation.md:
-- the API's own Drizzle connection authenticates as the `postgres`
-- superuser, and Postgres superusers always bypass RLS, unconditionally.
-- These policies do NOT protect anything that goes through the Fastify
-- API. They exist for any OTHER, non-superuser connection to this
-- database — e.g. the Supabase anon/authenticated roles, if the frontend
-- or a future integration ever queries Postgres directly through
-- Supabase's PostgREST layer instead of through the API. Tenant isolation
-- for the API itself is enforced in Fastify route handlers.
--
-- The helper function lives in `public`, not `auth`: Supabase reserves
-- the `auth` schema for its own internals and the project's `postgres`
-- role does not have CREATE privileges there (confirmed by actually
-- running this migration — it fails with "permission denied for schema
-- auth" otherwise). `auth.jwt()` and `auth.role()` below are Supabase's
-- own pre-existing functions and remain callable; only a *new* function
-- had to move out of that schema.

create or replace function public.organization_id() returns uuid
  language sql stable
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', '')::uuid
$$;
--> statement-breakpoint

alter table "organizations" enable row level security;
alter table "org_members" enable row level security;
alter table "checklist_rules" enable row level security;
alter table "claims" enable row level security;
alter table "claim_status_events" enable row level security;
alter table "documents" enable row level security;
alter table "queries" enable row level security;
alter table "audit_log" enable row level security;
alter table "insurers" enable row level security;
alter table "procedures" enable row level security;
--> statement-breakpoint

create policy "members read own organization" on "organizations"
  for select using (id = public.organization_id());
--> statement-breakpoint

create policy "members read org roster" on "org_members"
  for select using (organization_id = public.organization_id());
--> statement-breakpoint

create policy "members read own checklist rules" on "checklist_rules"
  for select using (organization_id = public.organization_id());
--> statement-breakpoint
create policy "members write own checklist rules" on "checklist_rules"
  for insert with check (organization_id = public.organization_id());
--> statement-breakpoint
create policy "members update own checklist rules" on "checklist_rules"
  for update using (organization_id = public.organization_id());
--> statement-breakpoint

create policy "members read own claims" on "claims"
  for select using (organization_id = public.organization_id());
--> statement-breakpoint
create policy "members write own claims" on "claims"
  for insert with check (organization_id = public.organization_id());
--> statement-breakpoint
create policy "members update own claims" on "claims"
  for update using (organization_id = public.organization_id());
--> statement-breakpoint

create policy "members read own claim events" on "claim_status_events"
  for select using (
    claim_id in (select id from claims where organization_id = public.organization_id())
  );
--> statement-breakpoint
create policy "members write own claim events" on "claim_status_events"
  for insert with check (
    claim_id in (select id from claims where organization_id = public.organization_id())
  );
--> statement-breakpoint

create policy "members read own documents" on "documents"
  for select using (
    claim_id in (select id from claims where organization_id = public.organization_id())
  );
--> statement-breakpoint
create policy "members write own documents" on "documents"
  for insert with check (
    claim_id in (select id from claims where organization_id = public.organization_id())
  );
--> statement-breakpoint
create policy "members update own documents" on "documents"
  for update using (
    claim_id in (select id from claims where organization_id = public.organization_id())
  );
--> statement-breakpoint

create policy "members read own queries" on "queries"
  for select using (
    claim_id in (select id from claims where organization_id = public.organization_id())
  );
--> statement-breakpoint
create policy "members write own queries" on "queries"
  for insert with check (
    claim_id in (select id from claims where organization_id = public.organization_id())
  );
--> statement-breakpoint
create policy "members update own queries" on "queries"
  for update using (
    claim_id in (select id from claims where organization_id = public.organization_id())
  );
--> statement-breakpoint

create policy "members read own audit log" on "audit_log"
  for select using (organization_id = public.organization_id());
--> statement-breakpoint
create policy "members write own audit log" on "audit_log"
  for insert with check (organization_id = public.organization_id());
--> statement-breakpoint

-- insurers and procedures are shared reference data: readable by any
-- authenticated user, writable only via the API's own (superuser) path —
-- never user-editable directly.
create policy "authenticated users read insurers" on "insurers"
  for select using (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated users read procedures" on "procedures"
  for select using (auth.role() = 'authenticated');
