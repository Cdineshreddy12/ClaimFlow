-- Sanctioned amount, and enhancements as a workflow rather than a flag.
--
-- docs/adr/0004 modelled ENHANCEMENT_REQUESTED as its own claim status
-- on the grounds that an enhancement carries different data from a
-- document query — "requested additional amount" and its own deadline
-- clock. The status shipped; the data never did, so "Request
-- enhancement" was a button that recorded that the desk had asked for
-- more money without recording how much.
--
-- `claims.sanctioned_amount` is the other half of the same hole. The
-- schema could say what the hospital expected (the pre-auth form's
-- total_expected_cost) and what it billed, but never what the insurer
-- actually authorised — so the shortfall a claim ends in was
-- uncomputable, and an enhancement had no ceiling to be requested
-- against. See docs/adr/0012.

alter table "claims"
  add column if not exists "sanctioned_amount" numeric(12, 2);
--> statement-breakpoint

do $$
begin
  create type "enhancement_status" as enum (
    'REQUESTED',
    'APPROVED',
    'PARTIALLY_APPROVED',
    'REJECTED',
    'WITHDRAWN'
  );
exception
  when duplicate_object then null;
end $$;
--> statement-breakpoint

create table if not exists "enhancements" (
  "id" uuid primary key default gen_random_uuid(),
  "claim_id" uuid not null references "claims"("id") on delete cascade,
  "requested_amount" numeric(12, 2) not null,
  "reason" text not null,
  "status" "enhancement_status" not null default 'REQUESTED',
  -- Null while open. On a partial approval this is less than
  -- requested_amount, and the gap is the shortfall the claim ends in;
  -- one column could not have held both numbers.
  "approved_amount" numeric(12, 2),
  "sla_deadline" timestamp with time zone,
  "requested_by" uuid references "members"("id"),
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone not null default now()
);
--> statement-breakpoint

create index if not exists "enhancements_claim_id_idx"
  on "enhancements" ("claim_id");
--> statement-breakpoint

-- An enhancement is the live question on a claim, so the desk reads it
-- constantly: one index for "the open one on this claim".
create index if not exists "enhancements_open_idx"
  on "enhancements" ("claim_id", "status")
  where "status" = 'REQUESTED';
--> statement-breakpoint

-- Same caveat as every RLS block here: the API connects as superuser and
-- bypasses this. It defends any other, RLS-subject connection, and
-- single-tenant policies gate on being signed in at all (see 0015).
alter table "enhancements" enable row level security;
--> statement-breakpoint

create policy "authenticated read enhancements" on "enhancements"
  for select using (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated write enhancements" on "enhancements"
  for insert with check (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated update enhancements" on "enhancements"
  for update using (auth.role() = 'authenticated');
