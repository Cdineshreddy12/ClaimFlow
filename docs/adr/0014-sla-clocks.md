# 0014 — SLA clocks, and insurer turnaround

**Status: built. Deadlines are stamped server-side, the watch list and
the turnaround report are in.**

## Context

`claim_status_events.sla_deadline` has existed since the schema was
first written, with a comment saying it "backs the IRDAI/TPA SLA
countdowns". It did nothing of the kind:

- **Nothing computed it.** The column was filled only when a caller
  passed a value, which meant the deadline was whatever the browser
  said it was. docs/adr/0004 is explicit that SLA deadlines must be
  "persisted as server-side timestamps — never computed from the
  frontend clock", and the implementation did the opposite.
- **Nothing read it.** Grep returned writes and no reads. The dashboard
  substituted `claims.updated_at` and said so in a comment:
  `avgTimeInStageHours` was "a real, computable stand-in for the brief's
  discharge-wait metric, which would need event tracking this schema
  doesn't have yet". The schema did have it. It was just inert.

Meanwhile the brief's actual pain is a patient sitting in a discharged
bed waiting for an insurer to authorise, and IRDAI's 2024 master
circular puts hard windows on exactly that.

## Decision

- **The windows live in `@claimflow/contracts`**, one table:
  `PRE_AUTH_SENT` → 1 hour, `FINAL_BILL_SUBMITTED` → 3 hours, both from
  the IRDAI circular, and `ENHANCEMENT_REQUESTED` → 1 hour by
  inference. Each carries a `basis` string naming its source, and the
  enhancement one says plainly that no regulation covers it — a window
  the product invented must never read like a mandate.
- **The server stamps the deadline; the caller is not consulted.** A
  client-supplied deadline is a client-chosen deadline. A caller may
  still pass one for a status that has no regulatory window, and can
  never override one that does.
- **`owedBy` is part of the window.** A claim waiting on an insurer and
  a claim waiting on the desk are both "open", and only one of them is
  anybody here's fault. The watch list reports both totals, and says
  how many breaches are the insurer's.
- **`QUERY_RAISED` deliberately has no window.** The reply deadline is
  whatever the TPA's email said, which the query itself already stores
  and already flags when it was inferred from "within 48 hours".
  Inventing a second, regulatory-looking number would put two different
  deadlines in front of the desk for one promise.
- **Breach is computed, never stored.** A deadline is a fact; a breach
  is a comparison against the current time, and a persisted `breached`
  flag is true when written and wrong a minute later. Same reasoning as
  the checklist gap view in docs/adr/0001.
- **`met` is a distinct state from `ok` and `breached`.** A claim that
  was answered in time stops showing a countdown; one answered
  late-but-answered is a different fact from one still running.
- **Turnaround is measured between consecutive status events** — the
  clock starts when the desk sends and stops when the next status lands.
  **Requests still waiting are excluded rather than counted as fast**:
  an unanswered request has no duration yet, and treating it as zero
  flatters the insurer it is still waiting on.

## Consequences

- `GET /sla/watch` is the live queue, polled every 60 seconds by the UI.
  A countdown that is a minute stale is worse than no countdown, and
  this is the one query in the app that justifies polling.
- `GET /sla/turnaround` is the report a hospital takes into its next
  negotiation: its own timestamps, per insurer, next to the regulatory
  window. Nothing else in the product gives the hospital a number to
  push back with.
- Both queries are hand-written SQL — `distinct on (claim_id)` for the
  latest event per claim, a `lead()` window for how long the insurer
  took — because neither is expressible in the query builder. They are
  covered by integration tests against a real database, which is how we
  found that a bound `Date` has no encoder in the postgres-js protocol
  and throws at bind time; deadlines are passed as ISO strings with an
  explicit `::timestamptz`.
- `getClaimById` now carries the claim's current deadline as a
  correlated subquery, so every surface that renders a claim can say
  whether it's late without a second request.
- Migration 0019 adds a partial index on `sla_deadline where not null`:
  the overwhelming majority of events have no deadline and can never
  breach, so there's no reason to carry them in the index the sweep uses.
- `metrics.ts`'s `avgTimeInStageHours` stand-in is now redundant for the
  discharge question, though it still answers a different one (how long
  work has been sitting). Left in place.
