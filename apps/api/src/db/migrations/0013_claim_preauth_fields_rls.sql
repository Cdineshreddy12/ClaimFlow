-- Same caveat as 0001_row_level_security.sql: defence in depth for any
-- non-superuser connection; the API's own connection bypasses RLS.
-- Pre-auth fields inherit org scope through their claim, like deductions.

alter table "claim_preauth_fields" enable row level security;
--> statement-breakpoint

create policy "members read own preauth fields" on "claim_preauth_fields"
  for select using (
    claim_id in (select id from claims where organization_id = public.organization_id())
  );
--> statement-breakpoint
create policy "members write own preauth fields" on "claim_preauth_fields"
  for insert with check (
    claim_id in (select id from claims where organization_id = public.organization_id())
  );
--> statement-breakpoint
-- Updates matter here in a way they don't for deductions: confirming a
-- field edits an existing row rather than appending a new one.
create policy "members update own preauth fields" on "claim_preauth_fields"
  for update using (
    claim_id in (select id from claims where organization_id = public.organization_id())
  );
