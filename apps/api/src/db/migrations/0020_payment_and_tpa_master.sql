-- Two gaps against the client's feature list.
--
-- 1. Payment. The state machine already recorded *when* a claim was
--    submitted, settled or rejected, and `sanctioned_amount` records
--    what the insurer authorised — but nothing recorded what actually
--    arrived. "Sanctioned minus deductions" is an inference, not a
--    receipt, and the whole point of the deductions dashboard is that
--    those two numbers disagree.
--
-- 2. The TPA master was read-only seed data. A desk that takes on a new
--    TPA had no way to add one, and `is_active` matters more than
--    deletion: an insurer with claims against it can never be removed,
--    but it can stop being offered on new claims.

alter table "claims" add column if not exists "settled_amount" numeric(12, 2);
--> statement-breakpoint
-- A date, not a timestamp. "The money arrived on the 3rd" has no time
-- of day, and storing it as one meant new Date("2026-11-03T00:00:00")
-- parsed at local midnight and came back out as the 2nd in UTC.
alter table "claims" add column if not exists "settled_on" date;
--> statement-breakpoint

alter table "insurers" add column if not exists "is_active" boolean not null default true;
--> statement-breakpoint
alter table "insurers" add column if not exists "code" text;
--> statement-breakpoint
alter table "insurers" add column if not exists "contact_email" text;
--> statement-breakpoint
alter table "insurers" add column if not exists "updated_at" timestamp with time zone not null default now();
--> statement-breakpoint

-- Two TPAs with the same name on one desk is a mis-filing waiting to
-- happen. Case-insensitive, because "Company B" and "company b" are the
-- same organisation to everyone except a database.
create unique index if not exists "insurers_name_unique_ci" on "insurers" (lower("name"));
