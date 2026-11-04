-- Same caveat as 0001_row_level_security.sql: defence in depth for any
-- non-superuser connection; the API's own connection bypasses RLS.
-- deductions inherit org scope through their claim.

alter table "deductions" enable row level security;
--> statement-breakpoint

create policy "members read own deductions" on "deductions"
  for select using (
    claim_id in (select id from claims where organization_id = public.organization_id())
  );
--> statement-breakpoint
create policy "members write own deductions" on "deductions"
  for insert with check (
    claim_id in (select id from claims where organization_id = public.organization_id())
  );
