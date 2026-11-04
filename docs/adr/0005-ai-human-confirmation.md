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
