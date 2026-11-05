# 0013 — Appealing a deduction

**Status: built. Schema, API, the claim file's appeal actions and the
cross-claim worklist are in.**

## Context

docs/adr/0011 made the deduction history predictive: the desk is now
warned, before submission, about what this insurer has historically cut
from claims like this one. It did nothing about the money already gone.

Deductions were write-once. The desk recorded what was cut and why, the
dashboard totalled it for the month, and that was the end of it. In
practice most hospitals never contest a deduction — not because the
deductions are right, but because nobody tracks the appeals, so the work
is invisible and therefore never scheduled.

## Decision

- **A deduction carries an appeal lifecycle**: `NOT_CONTESTED` →
  `CONTESTED` → `RECOVERED` / `PARTIALLY_RECOVERED` / `UPHELD`.
- **`recovered_amount` is nullable, and zero is not null.** Null means
  "not resolved"; zero means "appealed and lost". Those must stay
  different — the second is what stops a desk appealing the same reason
  to the same insurer forever.
- **The outcome is derived from the money, never chosen.** A desk that
  could select "recovered in full" while typing a partial figure would
  eventually do it. `appealOutcomeFor(deducted, recovered)` lives in
  contracts and is the only thing that decides.
- **A recovery can never exceed the deduction.** The appeal is an
  argument about one deduction; getting back more than it took isn't a
  generous insurer, it's a typo, and it 422s.
- **An appeal can be resolved without being formally opened.** Insurers
  sometimes just pay. Forcing a `CONTESTED` step first would mean
  inventing a date nobody recorded.
- **The risk panel ranks on net, not gross.** A reason an insurer cuts
  often but gives back on appeal is a smaller risk than its gross total
  implies, and ranking on gross sends the desk chasing the wrong one.
  Both numbers are shown: "₹500,000 cut, ₹460,000 recovered" is a
  different and more useful fact than either half.
- **The worklist is read across claims**, not within one. "Every
  deduction still worth chasing" is a different question from "what
  happened to this claim", and it's the question that gets money back.

## Consequences

- Opening and resolving an appeal are `desk_head`/`org_admin`, same as
  recording a deduction: all three are financial facts about settlement.
  Reading the worklist is open to any desk user, because chasing one is
  the work.
- `deductions` gained an `appeal_status` index, because the worklist
  filters on it across every claim and `deductions_claim_id_idx` doesn't
  serve that.
- Migration 0018 adds the `update` policy on `deductions` that 0015
  never granted — nothing updated them before.
- The monthly summary now carries `recoveredTotal`, and the dashboard
  tile prefers it over the avoidable share when there is any: money
  clawed back is the newer fact, and the avoidable split is still on the
  breakdown card.
- A hospital that never appeals sees exactly what it saw before. The
  feature's cost is one button on a row; its upside is the only revenue
  line in the product that goes _up_.
