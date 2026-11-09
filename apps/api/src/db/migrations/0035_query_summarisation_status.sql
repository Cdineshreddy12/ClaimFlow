-- Whether the summariser ran on a query's email, and how it went.
--
-- A failed call and a query nobody asked the model about were
-- indistinguishable: both left ai_summary and summarised_by null, so
-- the desk could not tell "the model found nothing to say" from "the
-- model fell over", and nothing offered to try again.
alter table "queries"
  add column "summarisation_status" text not null default 'not_attempted';

-- Anything carrying a generated summary today succeeded, by definition.
-- Everything else keeps the default: it was never attempted as far as
-- any record here goes, which is the honest answer for rows written
-- before the column existed.
update "queries" set "summarisation_status" = 'ok' where "summarised_by" = 'claude';
