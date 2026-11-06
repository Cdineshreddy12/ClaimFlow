-- Which styling the printed pre-auth form uses.
--
-- A TPA desk sorts paper by shape before it reads a word, and hospitals
-- disagree about which shape clears fastest: the boxed grid their
-- insurers have processed for twenty years, a letterhead that looks
-- like the hospital, or the densest thing that still fits one sheet.
--
-- Styling only. Every template prints the same fields, in the layout's
-- own order, under the same rule that an unconfirmed value is a blank
-- line and never a number (docs/adr/0005).
alter table "hospital_profile"
  add column if not exists "preauth_template" text;
