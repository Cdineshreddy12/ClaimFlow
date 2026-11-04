# 0009 — Audit logging

## Context

Patient records are sensitive personal data under India's DPDP Act 2023,
and the client brief names audit logs as a hard constraint alongside
role-based access and India hosting.

The `audit_log` table has existed since the first migration, but nothing
wrote to it — the constraint was represented in the schema and nowhere
else, which is worse than not having the table, because it reads as
solved.

## Decision

**Writes happen in the service layer, never from a client.** There is no
POST route. Entries are produced as a side effect of real mutations, so
the trail can't be forged by the people it exists to hold accountable.

**What is audited** — every mutation that creates, changes or destroys
tenant data:

| Entity         | Actions                          |
| -------------- | -------------------------------- |
| claim          | created, status_changed          |
| document       | registered, confirmed, discarded |
| checklist_rule | created, updated, deleted        |
| query          | created, updated, replied        |
| organization   | created, profile_updated         |
| invite         | created, accepted                |

Reads are **not** audited. Logging every list and detail fetch would bury
the mutations that matter in noise; if read-access forensics is needed
later it belongs at the infrastructure layer, not inline here.

**Deltas, not row dumps.** `before`/`after` carry only the fields that
changed. Copying a whole claim row in would duplicate patient data into a
second table for no extra forensic value — the opposite of what
data-minimisation asks for. "Who changed what, when" is answerable from a
delta; "what was the patient's full record at the time" is not something
an audit log should be the second home for.

**Reads are gated to `org_admin` / `desk_head`.** A desk executive can't
read the trail of their own actions.

## Consequences

- `apps/api/src/modules/audit/` owns this: `record()` for writes,
  `GET /audit-log` (filterable by entityType/entityId) for reads.
- `checklistRepository.deleteRule` now returns the full row rather than
  just the id, because after a delete the row's contents are only
  knowable at that moment.
- Service `AuthContext`s that previously carried only `organizationId`
  (checklist, organizations) now also carry `userId`, to resolve the
  acting `org_members` row.

### The caveat worth knowing about

**Audit writes are not transactional with the mutation they describe.**
`record()` runs after the mutation has already committed, and it
deliberately never throws — raising would report failure for work that
actually succeeded. A failed write is logged to stderr instead.

That means a database failure in the narrow window between mutation and
audit write loses an entry. For a stricter guarantee the write has to
join the mutation's transaction, which needs a transaction handle
threaded through the repository layer — a change every repository would
feel, and not one worth making before there's a reason. Noted here so the
gap is a known limitation rather than an assumed guarantee.

No UI for the trail yet; it's reachable over the API only.
