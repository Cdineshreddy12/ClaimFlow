# 0001 — Checklist rules engine

## Context

Every claim's document requirements depend on which insurer/TPA and which
procedure it's for. The desk head configures these; the desk exec needs to
see, at a glance, what's missing before submitting. This is the piece the
client explicitly flagged as the hardest part of the build, and it's the
piece most likely to be gotten subtly wrong.

## Decision

- `checklist_rules` is keyed by `(organization_id, insurer_id, procedure_id, document_type)`,
  each row carrying a `required: boolean` flag.
- `insurers` and `procedures` are a **shared reference catalog** — the same
  insurer or procedure is the same real-world entity everywhere. Only the
  checklist rule itself (which documents that insurer needs for that
  procedure) is tenant-scoped.
- Rules are **versioned/snapshotted at claim creation**. A claim stores which
  checklist version it was opened against; editing the live rule set never
  retroactively changes what an in-flight claim requires.
- The gap view (`required − present`) is computed live from the claim's
  snapshot and its current documents — never persisted as a stored "missing"
  flag, which would drift from reality.

## Consequences

- Admin UI needs an explicit "changes apply going forward only" notice and a
  claim count per rule set, so the desk head understands the blast radius of
  an edit (see the Checklist Admin screen in the design mockup).
- Testing priority or this module: required-present, required-missing,
  optional-missing, uploaded-but-unconfirmed, one document satisfying
  multiple slots, and a rule changing after a claim already exists — these
  matter more than coverage percentage.
