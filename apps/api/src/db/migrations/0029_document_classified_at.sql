-- When a document was last read, as opposed to when it was uploaded.
--
-- A classification is an answer to "which of these slots", and the list
-- moves underneath it: a cost estimate was read on the 4th against six
-- slots, correctly refused them all, and on the 5th the claim gained a
-- "Cost estimate" slot. The stored refusal then described a checklist
-- that no longer existed.
--
-- The claim screen flags that by comparing each slot's `addedAt`
-- against when the document was read — and before this column the only
-- timestamp available was `created_at`, the upload. Re-reading a
-- document moved nothing, so the warning survived the very action that
-- resolved it.
alter table "documents"
  add column if not exists "classified_at" timestamp with time zone;
--> statement-breakpoint

-- Existing rows get the upload time, which is when they were in fact
-- classified: the only path that wrote these columns ran seconds after
-- the upload. Rows nothing ever read keep a null, which reads as "never
-- classified" rather than as a stale reading from 1970.
update "documents"
   set "classified_at" = "created_at"
 where "classified_at" is null
   and "classified_by" is not null;
