-- Indexes for the two features that read across claims rather than
-- within one.
--
-- The deduction-risk aggregate (docs/adr/0011) filters
-- claims(insurer_id, status) on every claim-file load, and that ADR had
-- to record the index as missing because the migration sequence was
-- being edited at the time. It isn't missing any more.
--
-- The SLA clock (docs/adr/0014) asks "which claims are past their
-- deadline" across the whole desk, which no per-claim index serves.

create index if not exists "claims_insurer_status_idx"
  on "claims" ("insurer_id", "status");
--> statement-breakpoint

create index if not exists "claims_status_idx"
  on "claims" ("status");
--> statement-breakpoint

-- Partial: a null deadline is the overwhelming majority of rows and can
-- never breach, so there is no reason to carry them in the index the
-- breach sweep uses.
create index if not exists "claim_status_events_sla_idx"
  on "claim_status_events" ("sla_deadline")
  where "sla_deadline" is not null;
