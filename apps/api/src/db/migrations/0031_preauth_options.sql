-- The rest of what a hospital can change about its printed form:
-- typeface, where the logo sits, the declaration wording, page
-- numbers, accented section names, a patient signature line.
--
-- One jsonb column rather than a column per switch. These are
-- presentation knobs on one document — nothing queries them and
-- nothing joins on them, and the set grows every time a hospital asks
-- for something. Six migrations of `add column ... boolean` would
-- teach a reader nothing.
--
-- Null reads as "all defaults"; the contract parses it that way, so
-- rows written before any given key existed keep working.
alter table "hospital_profile"
  add column if not exists "preauth_options" jsonb;
