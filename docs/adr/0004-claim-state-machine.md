# 0004 — Claim state machine

## Context

A claim, a document, and a TPA query each have their own lifecycle — they
are related but are not the same status enum. The claim lifecycle in
particular must match the client brief's own vocabulary (pre-auth, query,
approved, final bill, settled), not a generic SaaS "draft/submitted/approved"
model. The sample data includes an `Enhancement` status (requesting a higher
sanctioned amount mid-treatment, e.g. when actual cost exceeds the
pre-authorized limit) — a distinct workflow from a document query, with
different data (requested additional amount) and a different deadline clock.
Collapsing the two would be a real modeling bug, not a simplification.

## Decision

```
DRAFT → PRE_AUTH_SENT ⇄ (QUERY_RAISED | ENHANCEMENT_REQUESTED) → APPROVED
                     ↘ REJECTED                                → FINAL_BILL_SUBMITTED
                                                                → DISCHARGE_AUTHORISED → SETTLED
```

`DISCHARGE_AUTHORISED` is here for the same reason enhancement is kept
apart from query. One submission — the final bill — gets two different
answers back: permission to discharge the patient, which IRDAI gives the
insurer three hours for, and the money, which takes weeks and which no
regulation times.

With `SETTLED` as the only thing that could follow the final bill, the
gap between them was the wait for payment, and the three-hour window was
measured against it. Every insurer came out at 100% past target on
averages of five to seven hundred hours: a bank transfer wearing the
label of a patient waiting on a bed. Separated, the same report reads in
hours against the hours it is named after, and the wait for money is
left to the ageing report, which counts in days and claims no deadline
it cannot cite.

Implemented as a plain declarative transition table
(`packages/contracts/src/claims/status.ts`), not a state-machine library
(e.g. xstate). At this scale, a reviewer can audit a `Record<Status,
{to, roles}>` map in one read; a library's DSL adds a dependency without
adding guarantees this scale actually needs.

Each transition records: who performed it, what data was required, and the
resulting audit event — enforced at the same layer (Fastify RBAC) described
in `0002-authorization-and-tenant-isolation.md`.

`SETTLED` is the one transition with a precondition beyond the role: the
claim has to carry a settled amount. "Settled" is a claim about money
having arrived, and without the check it was only a claim about a
button having been pressed — a claim could sit at `SETTLED` with a
bill, no settled amount and no settlement date, which is exactly what
`db:verify` has always asserted against and what the demo data grew
once someone clicked it. Zero counts: a fully deducted claim settles at
nothing, and `null` is what "nobody has said" looks like.

The desk does not meet that refusal. _Mark settled_ on a claim with no
payment recorded opens the payment dialog and does both in one step;
the service-level check is the backstop for the API called directly,
and for the second half failing after the first succeeded. Recording a
payment stays its own act, because the money usually lands well before
anyone updates the status and that order has to stay recordable. The
only order no longer expressible is settled-with-no-money, which was
never a state the desk meant — just one nothing stopped.

## Consequences

- The document lifecycle (uploaded → classified → confirmed) and the query
  lifecycle (raised → responded → resolved) are separate state tables in
  `packages/contracts`, not folded into claim status.
- SLA deadlines (IRDAI's 1-hour pre-auth / 3-hour discharge expectations, and
  TPA query reply windows) are persisted as server-side timestamps on the
  relevant status-change event — never computed from the frontend clock.
- A transition may have a data precondition, not only a role one. `SETTLED`
  is the only one today; it is checked in `transitionClaimStatus` rather
  than in the transition table, because the table cannot see the claim.
- The write is conditional on the status the transition was validated
  against, and the status change and its event go in one transaction.
  Validating a claim and then writing it unconditionally let two desks
  both pass `canTransition` against the same status and both write, so a
  claim could end up holding an approval and a rejection at once;
  `db:verify` catches that afterwards, which is the wrong end of it. A
  refused write is a 409 naming where the claim actually is, and the
  claim file refetches on it — telling someone to reload while showing
  them the stale status is half an answer.
