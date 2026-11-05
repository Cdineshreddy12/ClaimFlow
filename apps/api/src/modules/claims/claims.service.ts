import {
  adviseEnhancement,
  canTransition,
  isTerminal,
  slaDeadlineFor,
  type ClaimFinancials,
  type ClaimStatus,
  type RecordPaymentBody,
  type Role,
} from "@claimflow/contracts";
import * as deductionsRepository from "../deductions/deductions.repository.js";
import * as enhancementsRepository from "../enhancements/enhancements.repository.js";
import * as preauthLayoutsService from "../preauth-layouts/preauth-layouts.service.js";
import * as preauthRepository from "../preauth/preauth.repository.js";
import { getRequirementsSnapshot } from "../checklist/checklist.service.js";
import * as documentsRepository from "../documents/documents.repository.js";
import { getMemberId } from "../members/members.repository.js";
import * as auditService from "../audit/audit.service.js";
import * as claimsRepository from "./claims.repository.js";
import type { CreateClaimBody, ListClaimsQuery } from "./claims.schema.js";

export class ClaimNotFoundError extends Error {}
export class SlotAlreadyOnClaimError extends Error {}
export class ChecklistAlreadySetError extends Error {}
export class SlotNotOnClaimError extends Error {}
export class OriginalSlotError extends Error {}
export class SlotInUseError extends Error {}
export class NoRulesToApplyError extends Error {}
export class InvalidTransitionError extends Error {}

interface AuthContext {
  userId: string;
  role: Role;
}

/**
 * desk_executive sees only their own assigned claims, regardless of what
 * the request asked for — this is the role-filtering half of the tenant
 * boundary described in docs/adr/0002 (the repository layer only enforces
 * the org half). desk_head and everyone above sees the full org.
 */
export async function listClaims(auth: AuthContext, query: ListClaimsQuery) {
  const statusFilter =
    query.status !== undefined ? { status: query.status } : {};
  const forceOwnClaimsOnly =
    auth.role === "desk_executive" || query.scope === "mine";

  if (forceOwnClaimsOnly) {
    const memberId = await getMemberId(auth.userId);
    return claimsRepository.listClaims({
      ...statusFilter,
      assignedTo: memberId,
    });
  }

  return claimsRepository.listClaims(statusFilter);
}

export async function getClaim(auth: AuthContext, id: string) {
  const claim = await claimsRepository.getClaimById(id);
  if (!claim) throw new ClaimNotFoundError(id);

  if (auth.role === "desk_executive") {
    const memberId = await getMemberId(auth.userId);
    if (claim.assignedTo !== memberId) throw new ClaimNotFoundError(id);
  }

  return claim;
}

/**
 * Captures the insurer/procedure's current checklist rules onto the claim
 * at the moment it's opened — see docs/adr/0001. Whatever the checklist
 * admin edits afterward never reaches back into claims already in flight.
 */
export async function createClaim(auth: AuthContext, body: CreateClaimBody) {
  const checklistSnapshot = await getRequirementsSnapshot(
    body.insurerId,
    body.procedureId,
  );
  // Frozen for the same reason the checklist is (docs/adr/0001): an
  // admin reordering or removing a pre-auth field next month must not
  // change what this claim asked for. A TPA query six weeks from now
  // has to be answerable against the form that was actually sent.
  const preauthLayoutSnapshot = await preauthLayoutsService.resolveLayout(
    body.insurerId,
  );
  const claim = await claimsRepository.createClaim(
    body,
    checklistSnapshot,
    preauthLayoutSnapshot,
  );

  await auditService.record(auth, {
    action: "claim.created",
    entityType: "claim",
    entityId: claim.id,
    after: {
      patientName: claim.patientName,
      status: claim.status,
      // Recorded on every claim, so "which claims were opened with no
      // checklist" is answerable afterwards rather than only
      // noticeable at the time.
      checklistRules: checklistSnapshot.length,
    },
  });

  if (checklistSnapshot.length === 0) {
    // Its own entry, because this is the quiet failure: a claim with
    // no checklist reports nothing missing for the rest of its life,
    // and at settlement that reads as a complete file.
    await auditService.record(auth, {
      action: "claim.opened_without_checklist",
      entityType: "claim",
      entityId: claim.id,
      after: {
        insurerId: body.insurerId,
        procedureId: body.procedureId,
      },
    });
  }

  return claim;
}

/**
 * Moves a claim, and stamps the clock the new status starts.
 *
 * The deadline is computed here, from the shared windows in
 * @claimflow/contracts, and the caller is not consulted. It used to be
 * whatever the client sent, which docs/adr/0004 explicitly forbids —
 * "never computed from the frontend clock" — and which made the SLA a
 * number the browser chose. A caller may still pass a deadline for the
 * statuses that have no regulatory window and get it recorded; it can
 * never override one that does.
 */
export async function transitionClaimStatus(
  auth: AuthContext,
  claimId: string,
  nextStatus: ClaimStatus,
  slaDeadline: Date | undefined,
) {
  const claim = await claimsRepository.getClaimById(claimId);
  if (!claim) throw new ClaimNotFoundError(claimId);

  if (!canTransition(claim.status, nextStatus, auth.role)) {
    throw new InvalidTransitionError(
      `${claim.status} -> ${nextStatus} not allowed for ${auth.role}`,
    );
  }

  const memberId = await getMemberId(auth.userId);
  const deadline =
    slaDeadlineFor(nextStatus, new Date()) ?? slaDeadline ?? undefined;
  const updated = await claimsRepository.recordStatusChange(
    claimId,
    nextStatus,
    memberId,
    deadline,
  );
  if (!updated) throw new ClaimNotFoundError(claimId);

  await auditService.record(auth, {
    action: "claim.status_changed",
    entityType: "claim",
    entityId: claimId,
    before: { status: claim.status },
    after: { status: nextStatus },
    actorId: memberId,
  });

  return updated;
}

/**
 * required docs in the claim's checklist snapshot minus the ones with a
 * *confirmed* document in that slot — the brief's "see at a glance what's
 * missing" requirement, computed live, never stored (see docs/adr/0001).
 */
export async function getClaimGaps(auth: AuthContext, claimId: string) {
  const claim = await getClaim(auth, claimId);
  const confirmedSlots = new Set(
    await documentsRepository.confirmedSlotsForClaim(claimId),
  );

  const missing = claim.checklistSnapshot
    .filter((item) => item.required && !confirmedSlots.has(item.documentType))
    .map((item) => item.documentType);
  const satisfied = claim.checklistSnapshot
    .filter((item) => confirmedSlots.has(item.documentType))
    .map((item) => item.documentType);

  return { missing, satisfied };
}

/**
 * Adds one checklist slot to one claim, after it was opened.
 *
 * This is not a hole in docs/adr/0001. That guarantee is about *rule
 * edits not reaching back*: a desk head tidying the checklist must not
 * silently grow new gaps across forty claims already in flight. This is
 * the opposite act — a person looking at one claim, holding a document
 * that belongs to it, saying "this claim also has one of these". Blast
 * radius one, deliberate, attributed, audited.
 *
 * Without it the two were conflated, and a document that fit no slot
 * had nowhere to go for the life of the claim: the only remedy on offer
 * was a rule change that by definition could not help the claim in
 * hand.
 *
 * **Added slots are never required.** The desk is making a place to put
 * something, not recording a new demand from the insurer — and a
 * required slot added by hand would open a gap that makes the claim
 * look incomplete the moment someone tries to file a document into it.
 * Once a document is confirmed there, it shows as satisfied like any
 * other.
 */
export async function addChecklistSlot(
  auth: AuthContext,
  claimId: string,
  documentType: string,
  /**
   * `required` is optional by default, and the default is the
   * important half: a slot added because a document turned up that fit
   * nowhere is a place to put something, not a demand from the
   * insurer. Restoring a checklist that should have been there is the
   * other case — those are the insurer's requirements, so that caller
   * passes both flags.
   */
  options: { required?: boolean; fromRules?: boolean } = {},
) {
  const required = options.required ?? false;
  const fromRules = options.fromRules ?? false;
  // Scopes to what this user may see, and a desk executive may do this
  // on their own claims — unlike a checklist *rule*, which reaches
  // every future claim for the pair and stays a desk head's call.
  const claim = await getClaim(auth, claimId);

  if (claim.checklistSnapshot.some((i) => i.documentType === documentType)) {
    throw new SlotAlreadyOnClaimError(documentType);
  }

  const memberId = await getMemberId(auth.userId);
  const updated = await claimsRepository.addChecklistSlot(claimId, {
    documentType,
    required,
    addedAt: new Date().toISOString(),
    addedBy: memberId,
    ...(fromRules ? { fromRules: true } : {}),
  });
  if (!updated) throw new ClaimNotFoundError(claimId);

  await auditService.record(auth, {
    action: "claim.checklist_slot_added",
    entityType: "claim",
    entityId: claimId,
    before: {
      checklistSlots: claim.checklistSnapshot.map((i) => i.documentType),
    },
    after: { documentType, required, fromRules },
    actorId: memberId,
  });

  return updated;
}

/**
 * Takes a hand-added slot back off one claim.
 *
 * **Only a slot a person added.** The slots that came from the rules
 * at creation are the record of what this claim was opened against,
 * and docs/adr/0001 exists to keep that record still. There is also a
 * blunter reason: the gap view is the safety net, and "delete the
 * requirement you cannot satisfy" is the one edit that would turn it
 * into a formality. Dropping an original requirement is a different
 * decision and should be argued for on its own.
 *
 * **Never a slot with a document in it.** Removing one would leave the
 * document on the claim counting toward nothing — the same invisible
 * state the assistant refuses to create when it files into a slot that
 * doesn't exist. Discard the document first.
 */
export async function removeChecklistSlot(
  auth: AuthContext,
  claimId: string,
  documentType: string,
) {
  const claim = await getClaim(auth, claimId);

  const item = claim.checklistSnapshot.find(
    (i) => i.documentType === documentType,
  );
  if (!item) throw new SlotNotOnClaimError(documentType);
  // Both kinds of "not yours to remove": snapshotted at creation, or
  // restored from the rules afterwards. Only a judgement call comes off.
  if (!item.addedAt || item.fromRules) {
    throw new OriginalSlotError(documentType);
  }

  const confirmedSlots =
    await documentsRepository.confirmedSlotsForClaim(claimId);
  if (confirmedSlots.includes(documentType)) {
    throw new SlotInUseError(documentType);
  }

  const memberId = await getMemberId(auth.userId);
  const updated = await claimsRepository.removeChecklistSlot(
    claimId,
    documentType,
  );
  if (!updated) throw new ClaimNotFoundError(claimId);

  await auditService.record(auth, {
    action: "claim.checklist_slot_removed",
    entityType: "claim",
    entityId: claimId,
    before: { documentType, required: item.required, addedAt: item.addedAt },
    actorId: memberId,
  });

  return updated;
}

/**
 * Gives a claim the checklist it should have been opened with.
 *
 * Only ever for a claim that has none. A claim opened against a pair
 * with no rules is snapshotted empty, and then reports nothing missing
 * for the rest of its life — which at settlement reads exactly like a
 * complete file. Adding the rules to the pair afterwards cannot reach
 * back (docs/adr/0001), so without this the claim stays unprotected
 * until it closes.
 *
 * **Refuses a claim that already has a checklist**, and that refusal is
 * what keeps this from being a hole in the forward-only guarantee. This
 * fills an absence; it never re-snapshots a claim whose requirements
 * were already decided.
 */
export async function applyCurrentRules(auth: AuthContext, claimId: string) {
  const claim = await getClaim(auth, claimId);
  if (claim.checklistSnapshot.length > 0) {
    throw new ChecklistAlreadySetError(claimId);
  }

  const rules = await getRequirementsSnapshot(
    claim.insurerId,
    claim.procedureId,
  );
  if (rules.length === 0) throw new NoRulesToApplyError(claimId);

  // One at a time, through the same path the assistant uses, so each
  // slot gets its own audit entry and the "who added this" question
  // has the same answer however it arrived.
  for (const rule of rules) {
    await addChecklistSlot(auth, claimId, rule.documentType, {
      required: rule.required,
      // Marked as the insurer's requirement rather than someone's
      // judgement, so it is no more removable than one snapshotted at
      // creation. Without this, restoring a checklist would quietly
      // make every requirement on it deletable.
      fromRules: true,
    });
  }

  return getClaim(auth, claimId);
}

/**
 * Where one claim's money stands.
 *
 * Four numbers the app held separately and never compared: what the
 * insurer sanctioned (including approved enhancements), what the
 * hospital expects to spend, what it billed, and what was cut and
 * clawed back after settlement. Put together they produce the only
 * figure a hospital CFO actually manages — the shortfall — and the one
 * the desk can still do something about, which is whether this claim
 * needs more cover before the patient goes home. See docs/adr/0012.
 */
export async function getClaimFinancials(
  auth: AuthContext,
  claimId: string,
): Promise<ClaimFinancials> {
  const claim = await claimsRepository.getClaimById(claimId);
  if (!claim) throw new ClaimNotFoundError(claimId);

  const [preauthRows, deductionTotals, openEnhancement] = await Promise.all([
    preauthRepository.listForClaim(claimId),
    deductionsRepository.totalsForClaim(claimId),
    enhancementsRepository.getOpenForClaim(claimId),
  ]);

  // Only a confirmed value counts. An unconfirmed suggestion is the
  // model's opinion, and basing "ask the insurer for ₹80,000 more" on
  // an opinion nobody has checked is exactly what adr 0005 forbids.
  const expectedRow = (preauthRows ?? []).find(
    (row) => row.fieldKey === "totalExpectedCost" && row.confirmedAt,
  );
  const expectedCost = expectedRow?.value ? Number(expectedRow.value) : null;

  const sanctionedAmount =
    claim.sanctionedAmount === null ? null : Number(claim.sanctionedAmount);
  const billedAmount =
    claim.billedAmount === null ? null : Number(claim.billedAmount);

  // The bill if there is one, otherwise what the desk expects to spend.
  // Deliberately the larger of the two when both exist: a bill that has
  // already outgrown the estimate is the number that matters.
  const costOnRecord =
    billedAmount !== null && expectedCost !== null
      ? Math.max(billedAmount, expectedCost)
      : (billedAmount ?? expectedCost);

  // A shortfall needs both a ceiling and a bill. Against an unrecorded
  // sanction it isn't a small number, it's an unknown one, and showing
  // zero there would read as "nothing was lost".
  const shortfall =
    sanctionedAmount === null || billedAmount === null
      ? null
      : Math.max(
          billedAmount -
            sanctionedAmount +
            deductionTotals.deducted -
            deductionTotals.recovered,
          0,
        );

  return {
    sanctionedAmount,
    expectedCost,
    billedAmount,
    deductedAmount: deductionTotals.deducted,
    recoveredAmount: deductionTotals.recovered,
    shortfall,
    utilisation:
      sanctionedAmount && costOnRecord !== null
        ? costOnRecord / sanctionedAmount
        : null,
    enhancement: adviseEnhancement({
      sanctionedAmount,
      costOnRecord,
      claimIsOpen: !isTerminal(claim.status),
      hasPendingEnhancement: Boolean(openEnhancement),
    }),
  };
}

/**
 * Records the two amounts a claim is judged by.
 *
 * Separate from the pre-auth form on purpose. The form holds what the
 * hospital *asked* for; these are what the insurer *authorised* and
 * what was *billed*, which arrive later, from a different document, and
 * which the form has no field for.
 */
export async function updateClaimFinancials(
  auth: AuthContext,
  claimId: string,
  facts: { sanctionedAmount?: number; billedAmount?: number },
) {
  const claim = await claimsRepository.getClaimById(claimId);
  if (!claim) throw new ClaimNotFoundError(claimId);

  const updated = await claimsRepository.updateConfirmedFacts(claimId, {
    ...(facts.sanctionedAmount !== undefined
      ? { sanctionedAmount: facts.sanctionedAmount.toString() }
      : {}),
    ...(facts.billedAmount !== undefined
      ? { billedAmount: facts.billedAmount.toString() }
      : {}),
  });
  if (!updated) throw new ClaimNotFoundError(claimId);

  const memberId = await getMemberId(auth.userId);
  await auditService.record(auth, {
    action: "claim.financials_updated",
    entityType: "claim",
    entityId: claimId,
    before: {
      sanctionedAmount: claim.sanctionedAmount,
      billedAmount: claim.billedAmount,
    },
    after: {
      sanctionedAmount: updated.sanctionedAmount,
      billedAmount: updated.billedAmount,
    },
    actorId: memberId,
  });

  return updated;
}

/**
 * Records a payment against a claim.
 *
 * Goes through getClaim so desk_executive scoping applies — an exec
 * can't record money against someone else's claim. Does not change
 * status: a payment can land before or after the desk marks a claim
 * settled, and forcing the order would make one of those impossible.
 */
export async function recordPayment(
  auth: AuthContext,
  claimId: string,
  body: RecordPaymentBody,
) {
  await getClaim(auth, claimId);

  // Passed straight through as a date string: turning it into a Date
  // parsed at local midnight and stored the previous day in UTC.
  const updated = await claimsRepository.recordPayment(
    claimId,
    body.settledAmount.toFixed(2),
    body.settledOn,
  );
  if (!updated) throw new ClaimNotFoundError(claimId);

  await auditService.record(auth, {
    action: "claim.payment_recorded",
    entityType: "claim",
    entityId: claimId,
    after: { settledAmount: updated.settledAmount, settledOn: body.settledOn },
  });

  return updated;
}
