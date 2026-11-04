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
                     ↘ REJECTED                                → FINAL_BILL_SUBMITTED → SETTLED
```

Implemented as a plain declarative transition table
(`packages/contracts/src/claims/status.ts`), not a state-machine library
(e.g. xstate). At this scale, a reviewer can audit a `Record<Status,
{to, roles}>` map in one read; a library's DSL adds a dependency without
adding guarantees this scale actually needs.

Each transition records: who performed it, what data was required, and the
resulting audit event — enforced at the same layer (Fastify RBAC) described
in `0002-authorization-and-tenant-isolation.md`.

## Consequences

- The document lifecycle (uploaded → classified → confirmed) and the query
  lifecycle (raised → responded → resolved) are separate state tables in
  `packages/contracts`, not folded into claim status.
- SLA deadlines (IRDAI's 1-hour pre-auth / 3-hour discharge expectations, and
  TPA query reply windows) are persisted as server-side timestamps on the
  relevant status-change event — never computed from the frontend clock.
