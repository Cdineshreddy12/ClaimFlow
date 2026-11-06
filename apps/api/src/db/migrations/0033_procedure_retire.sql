-- A procedure the hospital has stopped doing had nowhere to go.
--
-- The procedure master was built to the same shape as the insurer
-- master next door, and matched it on everything except the one thing
-- that matters on a list which lives for years. Insurers have two
-- operations: retire, which is reversible and only takes the row off
-- the pickers, and delete, which is refused the moment anything depends
-- on the row. Procedures only got delete.
--
-- Those two rules compose into a dead end. Delete is refused as soon as
-- a claim references the procedure — correctly, because a claim was
-- opened under that name and a six-week-old checklist snapshot has to
-- stay answerable (docs/adr/0001). So the only procedure that could
-- ever be removed was one nobody had used, and every real one stayed in
-- the "Open a claim" dropdown permanently.
--
-- `updated_at` comes along for the same reason it exists on insurers:
-- retiring is an edit, and an edit nobody can date is hard to argue
-- with later.

alter table "procedures" add column if not exists "is_active" boolean not null default true;
--> statement-breakpoint
alter table "procedures" add column if not exists "updated_at" timestamp with time zone not null default now();
