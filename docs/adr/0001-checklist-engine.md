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

## Amendment — adding a slot to one claim (2026-11-05)

The snapshot rule above was read, for a while, as "a claim's
requirements are frozen". It never said that. It says **rule edits do
not reach back**: a desk head tidying the checklist must not silently
grow new gaps across forty claims already in flight.

A person looking at one claim, holding a document that plainly belongs
to it, saying "this claim also has one of these" is the opposite act.
Blast radius one, deliberate, attributed. Conflating the two left
documents that fit no slot stranded for the life of a claim, with the
only remedy on offer — a rule change — unable by definition to help the
claim in hand.

So `claims.service.addChecklistSlot` appends a slot to a single claim's
snapshot. Three things keep it from becoming the hole this ADR exists to
prevent:

- **One claim, never a rule.** It writes to `claims.checklist_snapshot`
  and touches `checklist_rules` not at all. Changing what future claims
  ask for is still a separate, desk-head-gated action.
- **Added slots are optional.** The desk is making somewhere to put a
  document, not recording a new demand from the insurer. A hand-added
  `required` slot would open a gap that makes the claim look incomplete
  the moment someone tries to fill it.
- **Provenance stays on the item.** `addedAt` / `addedBy` on the
  snapshot entry, so a year later you can still tell which of a claim's
  requirements came from the rules and which a person added — the
  distinction this ADR is about, preserved in the data rather than in a
  convention.
