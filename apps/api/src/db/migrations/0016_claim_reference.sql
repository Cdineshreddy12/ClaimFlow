-- Give every claim a human reference.
--
-- The UI was showing the first eight characters of the primary key.
-- Nobody reads a claim out as "d6a86e42" — and the product brief's own
-- sample TPA email quotes "Claim Ref: CLM-3381", so a sequential
-- reference is what the desk and the insurer are already speaking.
--
-- The uuid stays the primary key and stays in URLs; it just stops being
-- something a person is asked to look at.

create sequence if not exists claim_reference_seq start 1;
--> statement-breakpoint

alter table "claims" add column if not exists "reference" text;
--> statement-breakpoint

-- Backfill in creation order so the oldest claim is CLM-0001 rather
-- than whatever order the update happens to visit rows in.
with ordered as (
  select id, row_number() over (order by created_at, id) as rn
  from claims
  where reference is null
)
update claims c
set reference = 'CLM-' || lpad(o.rn::text, 4, '0')
from ordered o
where o.id = c.id;
--> statement-breakpoint

-- Move the sequence past what the backfill used, so the next insert
-- doesn't collide with an existing reference.
select setval(
  'claim_reference_seq',
  greatest((select count(*) from claims), 1),
  (select count(*) from claims) > 0
);
--> statement-breakpoint

alter table "claims"
  alter column "reference"
  set default 'CLM-' || lpad(nextval('claim_reference_seq')::text, 4, '0');
--> statement-breakpoint

alter table "claims" alter column "reference" set not null;
--> statement-breakpoint

-- Unique because it's the thing a desk quotes to a TPA; two claims
-- answering to one reference is a phone call nobody can resolve.
create unique index if not exists "claims_reference_key" on "claims" ("reference");
