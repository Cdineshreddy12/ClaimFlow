# 0016 — Learning the checklist from TPA queries

**Status: built. The aggregate, the proposals and the apply action are
in.**

## Context

docs/adr/0001 calls the checklist rules engine "the piece the client
explicitly flagged as the hardest part of the build, and the piece most
likely to be gotten subtly wrong". It is also, today, a desk head typing
rules from memory into an admin screen.

Meanwhile every TPA query the desk logs is ground truth about exactly
that: an insurer asking for a document the checklist did not require is
the checklist being wrong, in writing, with a date on it. The query
summariser (docs/adr/0003) already extracts the requested items into a
structured list. Nothing read them back.

## Decision

- **Proposals, never automatic edits.** A rule change applies to every
  future claim for that insurer and procedure (docs/adr/0001 makes it
  forward-only, which bounds but does not remove the blast radius).
  That is not a decision to take from a pattern in a dozen emails
  without a human in the loop.
- **The denominator is on every row.** "Asked for on 9 of the last 14
  submitted claims" can be argued with; "64%" cannot. Same rule as the
  deduction risk panel (docs/adr/0011).
- **DRAFT claims are excluded from both halves of the ratio.** A claim
  never sent could not have been queried, and counting it would deflate
  every rate.
- **One claim asking twice for a document is one claim.**
  `count(distinct claim_id)`, because row counting would report rates
  above 100% and discredit the list.
- **Variants of one document name collapse into one proposal.**
  Requested items are free text written by a model reading an insurer's
  email, so "Copy of the discharge summary", "Discharge summaries" and
  "Discharge Summary" are one slot. The matcher normalises case,
  punctuation and plurals, drops padding words insurers add ("copy of",
  "duly filled", "report"), and then requires one name's meaningful
  tokens to be a **subset** of the other's.
- **It deliberately does not match on a single shared token.**
  "Treating doctor's note" and "Doctor's registration proof" share one
  word; treating those as one slot would file a document into the wrong
  gap. A one-word name only matches another one-word name, so "Bill"
  never swallows "Itemised bill".
- **Already-required rules produce no proposal.** If the checklist
  demanded it and the insurer still asked, the checklist is right and
  the desk failed to attach it. That is a document chase, which the
  claim's own deduction-risk panel already covers.
- **An existing optional rule is promoted, not duplicated**, and the
  proposal carries the existing slot's own wording, so accepting it can
  never create a near-duplicate rule.
- **Applying goes through the same service functions a desk head uses
  by hand**, so the duplicate check, the audit row and the
  forward-only guarantee are identical. Only the audit action differs,
  recording that a proposal rather than someone's memory put the rule
  there.

## Consequences

- `GET /checklist-rules/proposals` is readable by any desk user; seeing
  _why_ a rule is proposed is useful to whoever gets queried. Applying
  one is `desk_head`/`org_admin`.
- The card sits above the rule editor and outside its insurer/procedure
  filters, because a proposal is usually about the pair the desk head
  wasn't looking at.
- Thresholds (3 submitted claims, a third of them) live in contracts
  with the matcher, so the API's suppression rule and the UI's copy
  cannot drift.
- `requestedItemsByPair` is hand-written SQL (`jsonb_array_elements_text`
  through a lateral join) and is covered by an integration test against
  a real database — the row shapes and the distinct counting come from
  Postgres, not from TypeScript.
- The matcher is the part most likely to be wrong in a way nobody
  notices, so it is tested from both directions: names that must match,
  and names that must not.
