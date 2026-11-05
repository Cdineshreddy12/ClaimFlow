# 0011 — Deduction risk from the hospital's own history

**Status: built. Repository aggregate, service, API and the claim-file
panel are in; cross-tenant pooling is deliberately not.**

## Context

The product's premise (adr 0001, and the deduction reasons in
`packages/contracts/src/claims/deductions.ts`) is that most of the money
an insurer cuts is avoidable paperwork rather than clinical dispute.
That premise was already being measured after the fact: the desk records
a deduction with a reason at settlement, and the dashboard totals them
for the month against a 40%-reduction target.

Measuring it after the fact doesn't prevent any of it. By the time a
reason is recorded, the claim is settled and the money is gone. Mean-
while the same hospital, the same insurer and the same procedure will
produce the same deduction again next month, and nothing in the product
says so while the claim can still be changed.

Every other feature here makes the desk faster. This is the only one
that makes it money, which is also the only kind of claim a hospital CFO
renews a contract on.

## Decision

A claim's file shows what this hospital has lost on claims like this
one, drawn from its own settled history.

- **Statistics, not a model.** Counts and sums over `deductions` rows
  the desk entered itself. No API key, no inference, no score. This is a
  deliberate limit: adr 0005 requires a desk exec to be able to tell
  when the product is wrong, and "7 of the last 12 Star Health
  cholecystectomies lost money to a missing document" can be checked
  against the claims list, where a 73/100 risk score could not. An
  unfalsifiable number on a screen about someone's revenue is worse than
  no number.
- **The denominator is always shown.** A rate is rendered as
  `7 of the last 12`, never as a bare `58%`. The second form invites
  the reader to supply their own denominator, which is how a statistic
  drawn from twelve claims gets quoted as though drawn from hundreds.
- **`SETTLED` claims only, in the denominator and the numerator.** An
  in-flight claim hasn't had its chance to lose money yet, so counting
  it would deflate every rate; a `REJECTED` one lost all of it for
  reasons a deduction row doesn't describe. Both errors point the same
  way — understating risk — which is the one direction a warning must
  not err in.
- **Claims are counted distinctly per reason.** Two line items cut for
  the same reason on one claim are one claim that lost money that way.
  Counting rows would report rates above 100% in a bad month and
  discredit the whole panel.
- **The claim being assessed is excluded by id.** A settled claim must
  never become evidence about itself.
- **Scope narrows first, then widens.** `(insurer, procedure)` is the
  useful slice — insurers cut different things on different procedures —
  but it runs thin first, so below `PROCEDURE_SCOPE_MIN_CLAIMS` the
  assessment falls back to the insurer across all procedures, and the
  response carries which scope it used so the UI cannot imply the narrow
  one. Below `MIN_HISTORY_CLAIMS` settled claims it returns nothing at
  all rather than a rate off a sample of two.
- **Preventable reasons rank above expensive ones.** Sorting purely by
  money would let a policy mismatch — which the desk cannot do anything
  about — head a panel whose entire job is to be acted on. Non-
  preventable reasons still appear, labelled as such, because hiding
  them would misrepresent where the money actually goes.
- **The live join is the feature.** A `missing_document` warning carries
  the required checklist slots that are missing _right now_
  (`getClaimGaps`, adr 0001). History alone is a report; history plus
  the open gap is a thing the desk can close this afternoon. No other
  reason has an equivalent on-claim fact, so no other reason claims one.

## What is deliberately not here

- **No cross-tenant pooling.** Learning across hospitals is what would
  make this useful on a new tenant's first day, and `insurers` and
  `procedures` being a shared reference catalog (adr 0001) is exactly
  what makes it possible. It is still not built: it crosses the tenant
  isolation boundary in adr 0002 and needs its own record, an
  aggregate-only contract that can never carry PHI, and an explicit
  per-hospital opt-in. Doing it quietly inside this feature would have
  been the wrong way to find that out.
- **No prediction.** The panel never says what _will_ happen to this
  claim. `expectedCost` exists to rank rows and is described in the UI
  as an average of the past.
- **No gate.** Nothing blocks a submission on a risk warning. The desk
  decides; the product informs. Same rule as every AI surface here.

## Consequences

- `GET /claims/:claimId/deductions/risk` is readable by any desk user,
  unlike `POST /claims/:claimId/deductions`, which stays restricted to
  the roles accountable for recording a financial fact. Being warned is
  the job of whoever assembles the claim; recording is the desk head's.
- The aggregate runs two queries per claim-file load. The join side is
  covered by `deductions_claim_id_idx`, and the scope filter —
  `claims(insurer_id, status)` — got its index in migration 0019,
  alongside the SLA work (docs/adr/0014). It was missing when this ADR
  was first written.
- The risk figures became net of appeal recoveries in docs/adr/0013: a
  reason this insurer reliably gives back is a smaller risk than its
  gross total implies, and both numbers are now shown.
- A hospital with no settled history sees no panel at all. That is the
  correct empty state and not a bug — the feature's credibility is worth
  more than its coverage in month one.
- The thresholds (`MIN_HISTORY_CLAIMS`, `PROCEDURE_SCOPE_MIN_CLAIMS`)
  live in contracts so the API's suppression rule and the UI's copy
  cannot drift apart.
