-- Same caveat as 0001_row_level_security.sql: this does not protect the
-- Fastify API (superuser connection bypasses RLS) — it's defence in
-- depth for any other, non-superuser connection.
--
-- doctor_approvals has no organization_id of its own; it inherits scope
-- through its claim, the same shape used for documents and queries.

alter table "doctor_approvals" enable row level security;
--> statement-breakpoint

create policy "members read own doctor approvals" on "doctor_approvals"
  for select using (
    claim_id in (select id from claims where organization_id = public.organization_id())
  );
--> statement-breakpoint
create policy "members write own doctor approvals" on "doctor_approvals"
  for insert with check (
    claim_id in (select id from claims where organization_id = public.organization_id())
  );
--> statement-breakpoint
create policy "members update own doctor approvals" on "doctor_approvals"
  for update using (
    claim_id in (select id from claims where organization_id = public.organization_id())
  );
