# 0015 — Checking the pre-auth form before it is sent

**Status: built. Rules, the clinical read and the claim file's "Check
before sending" card are in.**

## Context

Insurers raise queries on arithmetic and dates far more often than on
clinical substance, and every query costs the desk days: a TPA email to
read, documents to re-send, a claim parked in `QUERY_RAISED` while a
patient waits. Most of those queries are about things the form already
contradicts on its face — an admission dated before the first
consultation, line items that don't come to the stated total, a missing
doctor registration number, a surgery named on a medical admission.

Nothing in the product read the form before it went out.

## Decision

Two halves, and every finding says which half produced it.

- **Deterministic rules, in `@claimflow/contracts`.** Dates in order,
  the estimate adding up, the form's own conditional branches, the
  identifiers insurers reject the form without, ICD-10 shape. Pure
  functions, no model, 25 tests. Routing arithmetic through a model
  would make a checkable fact unexplainable.
- **A model for clinical coherence only** — a diagnosis that doesn't
  match the named surgery, an ICD-10 code that matches neither, a line
  of treatment the findings don't support. It is told explicitly _not_
  to report arithmetic, dates or empty fields, because those are
  checked already and a duplicate finding is noise that teaches people
  to dismiss the panel.
- **Severity means what an insurer would do, not what the product
  will.** `blocker` means "this would come back as a query"; nothing is
  actually blocked. The desk still decides and still clicks send
  (docs/adr/0005).
- **Confirmed values only.** Reviewing an unconfirmed suggestion would
  be the product arguing with its own guess in front of the user.
- **The model's findings are filtered against the fields we sent.** A
  finding pointing at a field that doesn't exist can't be rendered
  against anything, and a hallucinated field key would reach the UI as
  a dead link. An unrecognised severity is downgraded to a warning: the
  model does not get to block on a value we couldn't parse.
- **A failed clinical read never reads as a clean form.** The response
  carries `clinicalReviewRan`, and the card says "Rules only — the
  clinical read didn't run" rather than implying a clean bill of health.
- **A POST, not a query.** The clinical half costs a model call, so it
  runs when the desk asks, not on every render of the claim file.

## Consequences

- `POST /claims/:claimId/preauth-fields/review` returns findings,
  blocker and warning counts, and whether the clinical half ran.
- The card sits _above_ the twenty-four-field form, not below it. Its
  whole job is to be read before someone clicks send, and a panel under
  twenty-four fields is a panel nobody scrolls to.
- Without `ANTHROPIC_API_KEY` the rules still run and still catch the
  majority of real insurer queries. Same fallback philosophy as
  document classification in docs/adr/0003.
- `ARITHMETIC_TOLERANCE` is ₹1: rupee rounding is real and a panel that
  flags it is a panel that gets ignored.
- The rules are the one place in the product that encodes what an
  insurer will reject. When the desk learns a new rejection reason, this
  is where it goes — and it needs no model call to pay off.
