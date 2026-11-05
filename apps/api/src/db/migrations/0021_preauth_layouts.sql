-- A configurable pre-authorisation form.
--
-- Model adapted from the dynamic-form system in the b2b-crm codebase:
-- layout → section → placement → definition. The split is what lets the
-- renderer know nothing about the fields, so adding one is data rather
-- than code.
--
-- One addition that codebase has no need for: `claims.preauth_layout_snapshot`.
-- A layout is frozen onto the claim when it's opened, exactly as the
-- document checklist already is (docs/adr/0001). Editing the form must
-- never change what an in-flight claim asked for — answering a TPA query
-- six weeks later means showing the form as it was sent, not as it is now.

create table if not exists "preauth_field_definitions" (
  "id" uuid primary key default gen_random_uuid() not null,
  -- The key a value is filed under. Immutable once anything references it.
  "field_key" text not null,
  "label" text not null,
  "field_type" text not null,
  "hint" text,
  "options" jsonb,
  -- The 24 IRDAI fields. Re-orderable and re-labellable, never deleted
  -- or retyped: a TPA expects "ICD-10 code" to hold an ICD-10 code.
  "is_standard" boolean not null default false,
  "conditional_on" jsonb,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
--> statement-breakpoint
create unique index if not exists "preauth_field_definitions_key_unique"
  on "preauth_field_definitions" ("field_key");
--> statement-breakpoint

create table if not exists "preauth_layouts" (
  "id" uuid primary key default gen_random_uuid() not null,
  "name" text not null,
  -- Null is the fallback, used by any insurer without one of their own.
  "insurer_id" uuid references "insurers"("id") on delete cascade,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
--> statement-breakpoint
-- At most one layout per insurer, and at most one fallback. A partial
-- index because NULLs don't collide in a plain unique index, which
-- would quietly allow several competing fallbacks.
create unique index if not exists "preauth_layouts_one_per_insurer"
  on "preauth_layouts" ("insurer_id") where "insurer_id" is not null;
--> statement-breakpoint
create unique index if not exists "preauth_layouts_single_default"
  on "preauth_layouts" ((true)) where "insurer_id" is null;
--> statement-breakpoint

create table if not exists "preauth_sections" (
  "id" uuid primary key default gen_random_uuid() not null,
  "layout_id" uuid not null references "preauth_layouts"("id") on delete cascade,
  "name" text not null,
  "display_order" integer not null default 0
);
--> statement-breakpoint
create index if not exists "preauth_sections_layout_idx"
  on "preauth_sections" ("layout_id");
--> statement-breakpoint

create table if not exists "preauth_placements" (
  "id" uuid primary key default gen_random_uuid() not null,
  "section_id" uuid not null references "preauth_sections"("id") on delete cascade,
  "field_definition_id" uuid not null
    references "preauth_field_definitions"("id") on delete cascade,
  "display_order" integer not null default 0,
  "label_override" text,
  "required" boolean not null default false
);
--> statement-breakpoint
create index if not exists "preauth_placements_section_idx"
  on "preauth_placements" ("section_id");
--> statement-breakpoint
-- The same field twice on one form is always a mistake, and it would
-- make the value ambiguous.
create unique index if not exists "preauth_placements_unique_field_per_section"
  on "preauth_placements" ("section_id", "field_definition_id");
--> statement-breakpoint

-- Frozen at claim creation. Null on claims opened before this existed;
-- those fall back to the live layout, which is the best available
-- answer for a claim that never had one.
alter table "claims"
  add column if not exists "preauth_layout_snapshot" jsonb;
--> statement-breakpoint

alter table "preauth_field_definitions" enable row level security;
--> statement-breakpoint
alter table "preauth_layouts" enable row level security;
--> statement-breakpoint
alter table "preauth_sections" enable row level security;
--> statement-breakpoint
alter table "preauth_placements" enable row level security;
--> statement-breakpoint

create policy "authenticated read field definitions" on "preauth_field_definitions"
  for select using (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated read layouts" on "preauth_layouts"
  for select using (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated read sections" on "preauth_sections"
  for select using (auth.role() = 'authenticated');
--> statement-breakpoint
create policy "authenticated read placements" on "preauth_placements"
  for select using (auth.role() = 'authenticated');
