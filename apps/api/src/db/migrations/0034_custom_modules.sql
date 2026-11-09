-- Modules a hospital defines for itself.
--
-- Every desk keeps something this product has no table for — a ward
-- round log, an implant register, a list of empanelment renewals. The
-- answer so far was a migration per idea, which means a release per
-- idea, which means the desk keeps using a spreadsheet.
--
-- The shape is the b2b-crm's custom-module system, narrowed: a module
-- row, a normalised field table describing its form, and records
-- holding the answers as one jsonb column.
--
-- Fields are normalised rather than held as JSON on the module,
-- unlike the CRM's webforms. Deliberate: these fields are referenced
-- by key from stored records, so they need stable ids, and a desk
-- should be able to ask "which modules have a field called amount"
-- without unpacking JSON in every row.
--
-- Records keep their answers in one jsonb column, which is the
-- opposite decision and the right one — the whole point is that a
-- module's shape is not known at migration time.

create table if not exists "custom_modules" (
  "id"           uuid primary key default gen_random_uuid(),
  "name"         text not null,
  "plural_name"  text not null,
  -- The URL segment. Generated from the name but stored, because a
  -- module renamed later must keep the address its records live at.
  "slug"         text not null unique,
  "description"  text,
  "is_active"    boolean not null default true,
  "sort_order"   integer not null default 0,
  "created_at"   timestamp with time zone not null default now(),
  "updated_at"   timestamp with time zone not null default now()
);
--> statement-breakpoint

create table if not exists "custom_module_fields" (
  "id"         uuid primary key default gen_random_uuid(),
  "module_id"  uuid not null references "custom_modules"("id") on delete cascade,
  -- Stable: a record's jsonb is keyed on this, so renaming the label
  -- must never move the data.
  "field_key"  text not null,
  "label"      text not null,
  -- The same set the pre-auth form builder offers, by design — one
  -- registry, so "Choice" means one thing across the product.
  "field_type" text not null,
  "required"   boolean not null default false,
  "options"    jsonb,
  "help_text"  text,
  "show_in_list" boolean not null default true,
  "sort_order" integer not null default 0,
  "created_at" timestamp with time zone not null default now(),
  constraint "custom_module_fields_key_unique" unique ("module_id", "field_key")
);
--> statement-breakpoint

create index if not exists "idx_custom_module_fields_module"
  on "custom_module_fields" ("module_id");
--> statement-breakpoint

create table if not exists "custom_module_records" (
  "id"         uuid primary key default gen_random_uuid(),
  "module_id"  uuid not null references "custom_modules"("id") on delete cascade,
  "data"       jsonb not null default '{}'::jsonb,
  "created_by" uuid references "members"("id") on delete set null,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);
--> statement-breakpoint

create index if not exists "idx_custom_module_records_module"
  on "custom_module_records" ("module_id", "created_at" desc);
