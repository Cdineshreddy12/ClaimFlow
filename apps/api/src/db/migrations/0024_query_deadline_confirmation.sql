-- The confirm step for a summarised reply deadline.
--
-- Every other thing the summariser or the classifier produces lands in
-- a suggestion column and waits for a human: `documents.checklist_slot`
-- next to `confirmed_at`, `claim_preauth_fields.ai_value` next to
-- `value`. The query deadline was the exception — it went straight into
-- `queries.deadline`, which the inbox sorts by and the dashboard counts
-- overdue off, with only `deadline_inferred` to hint that a model had
-- read it out of "within 48 hours". adr 0005 asks for better than a
-- hint.
--
-- Two axes rather than one: `deadline_inferred` stays as provenance
-- (how the value was arrived at), and this is whether a human has
-- vouched for it.
alter table "queries"
  add column if not exists "deadline_confirmed_by" uuid references "members"("id");
--> statement-breakpoint

alter table "queries"
  add column if not exists "deadline_confirmed_at" timestamp with time zone;
--> statement-breakpoint

-- Backfill the deadlines that were never suggestions. `summarised_by
-- is null` is the test, not `deadline_inferred = false`: the summariser
-- leaves that flag false when it reads an explicit date off the email,
-- so the flag alone can't tell a model's reading from a human's typing.
-- Nothing but a human could have put a deadline on a row the summariser
-- never touched.
--
-- confirmed_by stays null — nobody clicked anything, and naming a
-- member here would put a signature against a confirmation that never
-- happened.
update "queries"
set "deadline_confirmed_at" = "created_at"
where "deadline" is not null
  and "summarised_by" is null
  and "deadline_confirmed_at" is null;
