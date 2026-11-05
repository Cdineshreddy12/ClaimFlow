-- Make a deduction something that can be fought.
--
-- Deductions were write-once: the desk recorded what an insurer cut and
-- why, the dashboard totalled it, and that was the end of the money.
-- docs/adr/0011 made the history predictive; this makes it recoverable.
-- See docs/adr/0013.
--
-- `recovered_amount` is deliberately nullable rather than defaulting to
-- zero. Null means "not resolved"; zero means "appealed and lost", and
-- those two have to stay different — the second is what stops a desk
-- appealing the same reason to the same insurer forever.

do $$
begin
  create type "deduction_appeal_status" as enum (
    'NOT_CONTESTED',
    'CONTESTED',
    'RECOVERED',
    'PARTIALLY_RECOVERED',
    'UPHELD'
  );
exception
  when duplicate_object then null;
end $$;
--> statement-breakpoint

alter table "deductions"
  add column if not exists "appeal_status" "deduction_appeal_status"
    not null default 'NOT_CONTESTED';
--> statement-breakpoint
alter table "deductions"
  add column if not exists "recovered_amount" numeric(12, 2);
--> statement-breakpoint
alter table "deductions"
  add column if not exists "contested_at" timestamp with time zone;
--> statement-breakpoint
alter table "deductions"
  add column if not exists "resolved_at" timestamp with time zone;
--> statement-breakpoint
alter table "deductions"
  add column if not exists "appeal_note" text;
--> statement-breakpoint

-- The appeal worklist is "every deduction still worth chasing", read
-- across claims rather than within one, so it needs its own index —
-- deductions_claim_id_idx doesn't serve it.
create index if not exists "deductions_appeal_status_idx"
  on "deductions" ("appeal_status");
--> statement-breakpoint

-- 0015 granted insert and select on deductions but never update, because
-- nothing updated them. Appealing one does.
create policy "authenticated update deductions" on "deductions"
  for update using (auth.role() = 'authenticated');
