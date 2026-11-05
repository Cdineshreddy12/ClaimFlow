-- What a printed pre-auth form looks like, as opposed to what it says.
-- All nullable and none of it required by onboarding — a desk can
-- print and fax the form with no branding set, the way it always has.

alter table "hospital_profile"
  add column if not exists "logo_file_key" text;
--> statement-breakpoint

alter table "hospital_profile"
  add column if not exists "brand_accent_color" text;
--> statement-breakpoint

alter table "hospital_profile"
  add column if not exists "tagline" text;
--> statement-breakpoint

alter table "hospital_profile"
  add column if not exists "document_footer_note" text;
