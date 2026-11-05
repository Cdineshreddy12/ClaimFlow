-- Knowing a file is the same file.
--
-- A desk dropped Estimate_Pawar_GB.jpg in twice and the assistant
-- produced five sentences about whether it might be a duplicate, a
-- different patient, or a second episode — reasoning its way around a
-- fact nothing had recorded. A hash is that fact.
--
-- Nullable and unbackfilled: every attachment from before this has no
-- hash and simply will not match, which is the correct answer for a
-- file nobody measured. Documents uploaded through a claim page never
-- get one at all, which is why the check in assistant.service also
-- compares filenames against the claim the recogniser matched.
alter table "assistant_attachments"
  add column if not exists "content_hash" text;
--> statement-breakpoint

-- The lookup is "have I seen these bytes before", scoped to the member
-- who dropped them.
create index if not exists "assistant_attachments_hash_idx"
  on "assistant_attachments" ("content_hash", "uploaded_by");
