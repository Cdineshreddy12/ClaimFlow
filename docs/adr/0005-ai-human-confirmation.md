# 0005 — AI human-confirmation UX

## Context

AI classifies uploaded documents, pre-fills pre-auth fields, and summarizes
TPA query emails. The client was explicit: when the AI is wrong, the desk
staff must be able to tell and correct it — and nothing reaches an insurer
or TPA without a human clicking send.

## Decision

Three fixed UI rules, enforced the same way everywhere the AI appears
(prototyped in `docs/design/claims-desk-mockup.html`):

1. **Every pre-filled field shows its source snippet** and renders in a
   visually distinct "unconfirmed" state (dashed border) until a human
   clicks Confirm. There is no silent auto-trust path.
2. **Misclassified documents are draggable** to the correct checklist slot,
   or can be discarded — the AI's slot guess is a suggestion, not a
   placement.
3. **Query summaries always render the original email below them**, never
   replacing it. The summary is a convenience, not the record of truth.

Confidence is surfaced as a percentage in the current mockup; whether that
should become a plain-language band ("likely correct" / "check this one")
for non-technical staff is an open question — noted in the design critique,
not yet decided.

### Amendment — the reply deadline (2026-11-05)

Rule 3 covered the summary and left the deadline behind. In practice the
summariser wrote `queries.deadline` straight into the column the inbox
sorts by and the dashboard counts overdue off, with only
`deadline_inferred` to hint that a model had resolved "within 48 hours"
against a received date. Every other AI output in the product waits in a
suggestion column — `documents.checklist_slot` beside `confirmed_at`,
`claim_preauth_fields.ai_value` beside `value` — so this one was the
exception, and the asymmetry wasn't deliberate.

- **A summariser-derived deadline is unconfirmed until someone clicks.**
  `deadline_confirmed_at` / `_by` are a second axis, not a replacement
  for `deadline_inferred`: the flag records _how_ the date was arrived
  at and never changes, the stamp records _that a human vouched for it_.
  A desk exec who types a deadline gets both in one keystroke; the
  summariser only ever gets the first.
- **The countdown still shows while unconfirmed**, dashed, captioned
  with where the date came from, and with Confirm beside it. Hiding it
  would have been the stricter reading of rule 1 and the wrong call — a
  desk that doesn't know a deadline exists is worse off than one holding
  an unvouched date, and the overdue count stays honest either way.
- **Clearing is part of confirming.** An inferred deadline that's simply
  wrong has to be removable, or it sits in the inbox being counted
  overdue forever; an empty field saves as "no deadline", which is a
  different fact from nobody having looked.

## Consequences

- The frontend needs one reusable `<AiSuggestion>`-style component (value,
  confidence, source, onConfirm) used across the field-prefill, document-sort,
  and query-summary surfaces, rather than three one-off implementations.
- "Send" actions (reply to a TPA, submit a packet) are never wired to fire
  automatically from an AI result — they require an explicit, separate user
  action every time, even after a field has been confirmed.
- The query inbox's "Mark as replied" button follows the same rule from
  the other direction: it only records that a reply went out through
  whatever channel (email, the TPA's own portal) — the schema has no
  field for the reply's body, only a `replySentAt` timestamp, so there's
  nothing for this app to send even if it wanted to.
