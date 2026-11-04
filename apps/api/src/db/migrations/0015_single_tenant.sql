-- Collapse the multi-tenant model into a single-hospital deployment.
--
-- ClaimFlow now runs one install per hospital. `organizations` becomes
-- `hospital_profile`, a one-row settings table holding the identity that
-- goes on a pre-auth form and on anything sent to a TPA — ROHINI id,
-- registration, GSTIN, address, desk contact. The per-tenant billing
-- columns go with the tenancy that justified them.
--
-- Roles stay. The brief needs Desk Executive (own claims) and Desk Head
-- (all claims + admin), so `org_members` becomes `members` and keeps its
-- role column; only the organization scoping is removed.
--
-- Written to run on a database that already has data: the oldest
-- organization wins, and rows belonging to any other are deleted rather
-- than silently re-pointed, because merging two hospitals' claim files
-- into one would be worse than losing the test data.

-- --- 1. Drop every policy on the tables being reshaped ----------------
-- By table rather than by name: the policy names drifted from what this
-- migration originally assumed (invites carried "members read own
-- organization invites", not "members read own invites"), and a DROP
-- POLICY that silently skips is worse than one that can't miss — the
-- column drop below fails on any policy still depending on it.
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'organizations', 'hospital_profile', 'org_members', 'members',
        'checklist_rules', 'claims', 'claim_status_events', 'documents',
        'queries', 'audit_log', 'invites', 'deductions',
        'doctor_approvals', 'claim_preauth_fields'
      )
  loop
    execute format('drop policy if exists %I on %I.%I',
                   r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;
--> statement-breakpoint

-- --- 2. Keep one hospital, discard rows belonging to any other ---------
-- Deleting rather than re-pointing: two organizations' claims merged into
-- one file would be a data-integrity problem nobody could unpick later.
do $$
begin
  if to_regclass('public.organizations') is null then return; end if;
  delete from claims
    where organization_id <> (select id from organizations order by created_at limit 1);
  delete from checklist_rules
    where organization_id <> (select id from organizations order by created_at limit 1);
  delete from audit_log
    where organization_id <> (select id from organizations order by created_at limit 1);
  delete from invites
    where organization_id <> (select id from organizations order by created_at limit 1);
  delete from org_members
    where organization_id <> (select id from organizations order by created_at limit 1);
  delete from organizations
    where id <> (select id from organizations order by created_at limit 1);
exception
  when undefined_column then null;  -- already dropped by an earlier run
end $$;
--> statement-breakpoint

-- --- 3. Drop the scoping columns ---------------------------------------
alter table "claims" drop column if exists "organization_id";
--> statement-breakpoint
alter table "checklist_rules" drop column if exists "organization_id";
--> statement-breakpoint
alter table "audit_log" drop column if exists "organization_id";
--> statement-breakpoint
alter table "invites" drop column if exists "organization_id";
--> statement-breakpoint
alter table "org_members" drop column if exists "organization_id";
--> statement-breakpoint

-- checklist_rules was unique per (org, insurer, procedure, documentType);
-- without the org it is unique per (insurer, procedure, documentType).
-- Drizzle generated the old name from the column list.
alter table "checklist_rules"
  drop constraint if exists "checklist_rules_organization_id_insurer_id_procedure_id_document_type_unique";
--> statement-breakpoint
do $$ begin
  alter table "checklist_rules"
    add constraint "checklist_rules_insurer_id_procedure_id_document_type_unique"
    unique ("insurer_id", "procedure_id", "document_type");
exception when duplicate_table or duplicate_object then null;
end $$;
--> statement-breakpoint

-- --- 4. organizations -> hospital_profile, one row ---------------------
do $$ begin
  if to_regclass('public.organizations') is not null
     and to_regclass('public.hospital_profile') is null then
    alter table "organizations" rename to "hospital_profile";
  end if;
end $$;
--> statement-breakpoint
alter table "hospital_profile" drop column if exists "slug";
--> statement-breakpoint
alter table "hospital_profile" drop column if exists "subscription_status";
--> statement-breakpoint
alter table "hospital_profile" drop column if exists "plan";
--> statement-breakpoint
alter table "hospital_profile" drop column if exists "razorpay_customer_id";
--> statement-breakpoint
alter table "hospital_profile" drop column if exists "razorpay_subscription_id";
--> statement-breakpoint
alter table "hospital_profile" drop column if exists "trial_ends_at";
--> statement-breakpoint

-- Enforces the singleton in the database rather than hoping the service
-- layer never inserts a second one.
create unique index if not exists "hospital_profile_singleton"
  on "hospital_profile" ((true));
--> statement-breakpoint

-- --- 5. org_members -> members ----------------------------------------
do $$ begin
  if to_regclass('public.org_members') is not null
     and to_regclass('public.members') is null then
    alter table "org_members" rename to "members";
  end if;
end $$;
--> statement-breakpoint
drop index if exists "org_members_organization_id_idx";
--> statement-breakpoint

-- --- 6. Policies again, without the tenant predicate -------------------
-- Everyone signed in belongs to the one hospital, so the question these
-- answered ("is this row yours?") no longer exists. Same caveat as
-- 0001: the API connects as superuser and bypasses all of this; it
-- protects any other, RLS-subject connection.
alter table "hospital_profile" enable row level security;
--> statement-breakpoint
alter table "members" enable row level security;
--> statement-breakpoint

create policy "authenticated read hospital profile" on "hospital_profile"
  for select using (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated read roster" on "members"
  for select using (auth.role() = 'authenticated');
--> statement-breakpoint

create policy "authenticated read checklist rules" on "checklist_rules"
  for select using (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated write checklist rules" on "checklist_rules"
  for insert with check (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated update checklist rules" on "checklist_rules"
  for update using (auth.role() = 'authenticated');
--> statement-breakpoint

create policy "authenticated read claims" on "claims"
  for select using (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated write claims" on "claims"
  for insert with check (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated update claims" on "claims"
  for update using (auth.role() = 'authenticated');
--> statement-breakpoint

create policy "authenticated read claim events" on "claim_status_events"
  for select using (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated write claim events" on "claim_status_events"
  for insert with check (auth.role() = 'authenticated');
--> statement-breakpoint

create policy "authenticated read documents" on "documents"
  for select using (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated write documents" on "documents"
  for insert with check (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated update documents" on "documents"
  for update using (auth.role() = 'authenticated');
--> statement-breakpoint

create policy "authenticated read queries" on "queries"
  for select using (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated write queries" on "queries"
  for insert with check (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated update queries" on "queries"
  for update using (auth.role() = 'authenticated');
--> statement-breakpoint

create policy "authenticated read audit log" on "audit_log"
  for select using (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated write audit log" on "audit_log"
  for insert with check (auth.role() = 'authenticated');
--> statement-breakpoint

create policy "authenticated read invites" on "invites"
  for select using (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated write invites" on "invites"
  for insert with check (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated update invites" on "invites"
  for update using (auth.role() = 'authenticated');
--> statement-breakpoint

create policy "authenticated read deductions" on "deductions"
  for select using (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated write deductions" on "deductions"
  for insert with check (auth.role() = 'authenticated');
--> statement-breakpoint

create policy "authenticated read doctor approvals" on "doctor_approvals"
  for select using (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated write doctor approvals" on "doctor_approvals"
  for insert with check (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated update doctor approvals" on "doctor_approvals"
  for update using (auth.role() = 'authenticated');
--> statement-breakpoint

create policy "authenticated read preauth fields" on "claim_preauth_fields"
  for select using (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated write preauth fields" on "claim_preauth_fields"
  for insert with check (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated update preauth fields" on "claim_preauth_fields"
  for update using (auth.role() = 'authenticated');
--> statement-breakpoint

-- --- 7. The JWT only needs a role now ----------------------------------
-- The grant and policy from 0014 follow org_members through the rename,
-- but restating them here keeps a fresh database correct no matter which
-- order someone reads these in, and makes the dependency obvious: the
-- hook below reads `members` as supabase_auth_admin, which neither
-- bypasses RLS nor owns the table.
grant select on table public.members to supabase_auth_admin;
--> statement-breakpoint
drop policy if exists "auth admin reads memberships" on public.members;
--> statement-breakpoint
create policy "auth admin reads memberships" on public.members
  as permissive for select to supabase_auth_admin using (true);
--> statement-breakpoint

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  member_role text;
begin
  select role::text into member_role
  from public.members
  where user_id = (event->>'user_id')::uuid
  limit 1;

  claims := event->'claims';

  if member_role is not null then
    claims := jsonb_set(claims, '{app_metadata,role}', to_jsonb(member_role));
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;
--> statement-breakpoint
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
--> statement-breakpoint
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
--> statement-breakpoint

drop function if exists public.organization_id();
