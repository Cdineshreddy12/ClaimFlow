-- Same caveat as 0001_row_level_security.sql: this does not protect the
-- Fastify API (superuser connection bypasses RLS unconditionally) — it's
-- defense-in-depth for any other, non-superuser connection to this table.

alter table "invites" enable row level security;
--> statement-breakpoint

create policy "members read own organization invites" on "invites"
  for select using (organization_id = public.organization_id());
--> statement-breakpoint
create policy "members write own organization invites" on "invites"
  for insert with check (organization_id = public.organization_id());
--> statement-breakpoint
create policy "members update own organization invites" on "invites"
  for update using (organization_id = public.organization_id());
