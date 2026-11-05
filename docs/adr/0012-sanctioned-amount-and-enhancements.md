# 0012 — The sanctioned amount, and enhancements as a workflow

**Status: built. Schema, API and the claim file's Money tab are in.**

## Context

The product could say what a hospital _expected_ to spend (the pre-auth
form's `totalExpectedCost`), what it _billed_ (`claims.billed_amount`),
and what was _cut_ (`deductions`). It could not say what the insurer
**authorised**. There was no column for it.

Three things followed from that hole:

- **No realisation rate.** Settled over billed — the number a hospital
  CFO actually manages — was uncomputable. Deduction totals alone don't
  give it.
- **`ENHANCEMENT_REQUESTED` was a status with no data behind it.**
  docs/adr/0004 argues, correctly, that an enhancement deserves its own
  claim status _precisely because_ it carries different data from a
  document query: a requested additional amount and its own clock. The
  status shipped in that ADR; the data never did. "Request enhancement"
  was a button that recorded that the desk had asked for more money
  without recording how much.
- **No warning before the ceiling was breached.** The real-world loss is
  treatment crossing the sanctioned amount mid-admission, discovered at
  discharge, when the hospital either eats the difference or asks the
  patient for cash at the bedside.

A fourth problem was hiding behind the first. `totalExpectedCost`, once
confirmed, wrote _through_ to `claims.billed_amount`. Expected cost is
what the hospital asked the insurer to cover; billed amount is what it
charged at discharge. Treating them as one number made every shortfall
compute as zero.

## Decision

- **`claims.sanctioned_amount`** holds what the insurer authorised,
  including every approved enhancement.
- **`enhancements` is its own table**, not a column. An enhancement has
  its own money (asked for, granted), its own outcome and its own clock;
  a hospital that asked for ₹80,000 and was given ₹50,000 needs both
  numbers afterwards to know where the shortfall came from, and one
  column keeps neither. A long admission can need several.
- **An approval raises the claim's ceiling in the same transaction** that
  records it. A claim whose sanctioned amount excludes an approved
  enhancement understates its own ceiling, which is the hole this ADR
  exists to close — so the two writes cannot be allowed to drift.
  `coalesce(sanctioned, 0) + granted`, so the first enhancement on a
  claim with no recorded sanction still produces a ceiling.
- **One open enhancement per claim.** Two live requests against one
  admission isn't a workflow an insurer will answer; it's two desk execs
  who didn't know about each other, and the right outcome is a 409 that
  says so rather than a duplicate the TPA gets to choose between.
- **A decided enhancement is never re-decided.** The granted amount has
  already moved the ceiling, so a second decision would move it twice.
  Correcting a mis-entry is a new fact, not an edit of this one.
- **Advise at 80% of the ceiling, not at 100%.** An enhancement takes
  the insurer hours it doesn't promise, so a request sent the moment
  cost crosses the ceiling arrives too late to stop a cash demand at
  discharge. The cost of being early is a phone call; the cost of being
  late lands on the patient.
- **Advice comes from confirmed values only.** An unconfirmed pre-auth
  suggestion is the model's opinion, and "ask the insurer for ₹80,000
  more" is too consequential to rest on one (docs/adr/0005).
- **The shortfall is null, not zero, without both a ceiling and a bill.**
  Zero reads as "nothing was lost"; null reads as "we don't know yet",
  which is the truth.
- **`totalExpectedCost` no longer writes through to `billed_amount`.**
  The billed amount and the sanctioned amount are recorded explicitly,
  through `PATCH /claims/:claimId/financials`, because they arrive later
  and from different documents than the estimate.

## Consequences

- `GET /claims/:claimId/financials` is the one place the four numbers
  meet, and the only place the enhancement advice is computed. The
  advice logic itself is pure and lives in `@claimflow/contracts`, so
  the API and the UI cannot disagree about whether a claim needs cover.
- Recording a decision is `desk_head`/`org_admin` — it moves money.
  _Requesting_ an enhancement is open to any desk user: the exec
  watching the cost cross the ceiling is the one who knows, and making
  them find a desk head first is how the request arrives after discharge.
- The claim file gains a Money tab, badged "Needs cover" when the advice
  fires. That badge is the feature; the rest of the tab is a record.
- Enhancement requests stamp their own SLA deadline (docs/adr/0014), and
  move the claim to `ENHANCEMENT_REQUESTED` when the state machine
  allows — but do not fail if it doesn't. An already-approved claim can
  still need more money, and losing the request because the status
  wouldn't budge would lose the fact that matters most.
- Dashboards that read `billed_amount` now show it empty until a bill is
  actually recorded, where before they showed the estimate. That is the
  correct reading of a column named "billed", and the reason the
  shortfall works at all.
