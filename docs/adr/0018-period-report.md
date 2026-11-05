# 0018 — The period report

**Status: built. `GET /reports/period` and `GET /reports/period.pdf`, and a
desk_head-only Reports screen.**

## Context

The CFO signs the deal and funds the next budget cycle, but has no
login — every other screen in the product is built for a desk
executive, a desk head, or a doctor with a 48h link, and none of them
answer "did this actually work" in a form that leaves the app.

The dashboard already answers a version of this question, but only for
"this month so far": `deductions.summarise` and
`sla.getTurnaroundReport` both take a `since` with no upper bound,
because a live dashboard is supposed to keep moving. A report about
October, read in December, must not keep moving — it needs a closed
`[from, to)`, or a deduction entered in November would quietly inflate
a report that was supposed to be finished.

## Decision

- **No new analytics.** `deductions.summarise` and
  `sla.getTurnaroundReport` already compute the two numbers a hospital
  cares about — deductions by reason, and insurer turnaround against
  the regulatory window. Both gained an optional `until` parameter
  rather than being duplicated; the dashboard and Turnaround page keep
  calling them with none, unchanged.
- **One new number: a period's claim volume and turnaround**, from
  `created_at` to `settled_on`, measured end to end rather than stage
  to stage — a CFO wants to know how long money takes to land, not
  which stage statistic happens to be stored. `opened` and `settled`
  are independent `FILTER` clauses over one `claims` table, not two
  halves of one `WHERE`: a claim opened in September and settled in
  October must count as this October's settlement without counting as
  this October's new claim.
- **Generated, not emailed.** The report is a desk-head action
  (`requireRole("org_admin", "desk_head")`, same gate as Checklist
  Admin and recording a deduction), downloaded as a PDF and forwarded
  by hand. Auto-emailing a CFO would need a mail-sending integration
  this product doesn't have yet, and the forward-by-hand version ships
  this cycle instead of waiting on that decision.
- **A calendar month, not an arbitrary range.** `?month=2026-10` matches
  how the deductions summary and the dashboard already talk about
  "this month"; a free date-range picker is more flexible than anyone
  asked for.
- **The PDF reuses `packet.builder.ts`'s layout**, not a second
  library or a second margin constant — same A4 page, same letterhead
  block, same font pair. A multi-page table is handled with a cursor
  that starts a new page before a row would cross the margin, rather
  than truncating or letting it run off — a report silently missing a
  row is worse than a two-page report.

## Consequences

- `GET /reports/period` and `GET /reports/period.pdf` both 403 a desk
  executive, same as recording a deduction. The web nav hides the link
  for that role; the page itself still has to say why rather than show
  nothing, since a direct link bypasses the nav.
- `reports.repository.periodClaimsSummary` is hand-written SQL, covered
  by an integration test against a real database — the case worth
  proving is exactly the one a careless single `WHERE` would get wrong:
  a claim opened outside the window but settled inside it, or the
  reverse.
- The Razorpay billing roadmap item is unrelated to this — billing was
  for a multi-tenant SaaS and this install has one hospital. This
  report is the artifact that replaces what billing would have proven:
  that the money this product is supposed to save is actually being
  saved.
