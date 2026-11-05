-- Two-column sections, as in the b2b-crm's layout designer.
--
-- A pre-auth form is mostly short fields — a date, an ICD code, an
-- amount — and one field per full-width row wastes most of the page
-- and makes a 24-field form twice as long to scroll. Prose fields
-- still span the section.

alter table "preauth_sections"
  add column if not exists "column_count" integer not null default 1;
--> statement-breakpoint

-- Which column a field sits in. Meaningless when the section is
-- single-column, which is why it defaults to 0 rather than being
-- nullable — "no column" and "the first column" are the same thing.
alter table "preauth_placements"
  add column if not exists "column_position" integer not null default 0;
--> statement-breakpoint

alter table "preauth_sections"
  add constraint "preauth_sections_column_count_sane"
  check ("column_count" between 1 and 2);
--> statement-breakpoint

-- Backfill a layout seeded before columns existed. Prose stays in the
-- first column (it reads badly at half width); everything else
-- alternates, which is what the default would have produced.
update "preauth_sections" set "column_count" = 2
where "column_count" = 1;
--> statement-breakpoint

with ordered as (
  select p.id,
         d.field_type,
         row_number() over (
           partition by p.section_id order by p.display_order, p.id
         ) - 1 as rn
  from preauth_placements p
  join preauth_field_definitions d on d.id = p.field_definition_id
)
update preauth_placements p
set column_position = case when o.field_type = 'longtext' then 0
                           else (o.rn % 2) end
from ordered o
where o.id = p.id;
