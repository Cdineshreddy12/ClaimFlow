-- Government scheme claims: the package, and what it pays.
--
-- PM-JAY and the state schemes do not take an estimate. The desk picks
-- a package from the scheme's rate master and the rate attached to that
-- code is what will be paid — nothing to itemise, nothing to negotiate.
--
-- A scheme is a payer on the existing `insurers` master (type =
-- 'scheme'), so checklist rules, pre-auth layouts, receivables and
-- turnaround all key off it without a second table. The money model is
-- the only part that genuinely differs, and it lives here on the claim.
alter table "claims"
  add column if not exists "package_code" text,
  add column if not exists "package_rate" numeric(12, 2);
--> statement-breakpoint

alter table "claims"
  drop constraint if exists "claims_package_both_or_neither";
--> statement-breakpoint

-- Both or neither. A code with no rate leaves the claim worth nothing
-- on every money view; a rate with no code is an amount nobody can
-- trace back to the scheme's master.
alter table "claims"
  add constraint "claims_package_both_or_neither"
  check (("package_code" is null) = ("package_rate" is null));
--> statement-breakpoint

create index if not exists "claims_package_code_idx"
  on "claims" ("package_code");
