import {
  adviseEnhancement,
  canTransition,
  CLAIM_STATUS_LABEL,
  isSchemePayer,
  isTerminal,
  needsAttention,
  OVERVIEW_WAITING_LIMIT,
  statusesForFilter,
  trailingMonths,
  type ClaimListQuery,
  type ClaimOverview,
  slaDeadlineFor,
  type ClaimFinancials,
  type ClaimStatus,
  type RecordPaymentBody,
  type Role,
} from "@claimflow/contracts";
import * as insurersRepository from "../insurers/insurers.repository.js";
import * as deductionsRepository from "../deductions/deductions.repository.js";
import * as enhancementsRepository from "../enhancements/enhancements.repository.js";
import * as preauthLayoutsService from "../preauth-layouts/preauth-layouts.service.js";
import * as preauthRepository from "../preauth/preauth.repository.js";
import { getRequirementsSnapshot } from "../checklist/checklist.service.js";
import * as documentsRepository from "../documents/documents.repository.js";
import { getMemberId, getMemberById } from "../members/members.repository.js";
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
/** The claim moved between the read that validated it and the write. */
export class ConcurrentTransitionError extends Error {}
/** Marking a claim settled with no payment on record. */
export class SettlementNotRecordedError extends Error {}

interface AuthContext {
  userId: string;
  role: Role;
}

/**
 * desk_executive sees only their own assigned claims, regardless of what
 * the request asked for — this is the role-filtering half of the tenant
 * boundary described in docs/adr/0002 (the repository layer only enforces
 * the org half).
 */
export async function listClaims(auth: AuthContext, query: ListClaimsQuery) {
  // No limit: every match. The dashboard's charts and the
  // assistant's claim matching both need the whole set, not a page.
  const { rows } = await listClaimsPage(auth, {
    ...query,
    statusFilter: "all",
  });
  return rows;
}

/** One page of claims, with the total behind it (docs/adr/0002). */
export async function listClaimsPage(
  auth: AuthContext,
  query: ListClaimsQuery & ClaimListQuery,
) {
  const forceOwnClaimsOnly =
    auth.role === "desk_executive" || query.scope === "mine";
  const assignedTo = forceOwnClaimsOnly
    ? await getMemberId(auth.userId)
    : undefined;

  return claimsRepository.listClaims({
    ...(query.status !== undefined ? { status: query.status } : {}),
    ...(assignedTo !== undefined ? { assignedTo } : {}),
    statuses: query.status
      ? null
      : statusesForFilter(query.statusFilter ?? "open"),
    q: query.q,
    sort: query.sort,
    dir: query.dir,
    limit: query.limit,
    offset: query.offset,
  });
}

/** The dashboard, counted rather than fetched. */
export async function getClaimOverview(
  auth: AuthContext,
  now = new Date(),
): Promise<ClaimOverview> {
  const forceOwnClaimsOnly = auth.role === "desk_executive";
  const assignedTo = forceOwnClaimsOnly
    ? await getMemberId(auth.userId)
    : undefined;

  const months = trailingMonths(now);
  const first = months[0]!;

  const raw = await claimsRepository.claimOverview({
    ...(assignedTo ? { assignedTo } : {}),
    monthStart: new Date(now.getFullYear(), now.getMonth(), 1),
    trendStart: new Date(first.year, first.month, 1),
    needsAttention: statusesForFilter("attention") ?? [],
    openStatuses: statusesForFilter("open") ?? [],
    waitingLimit: OVERVIEW_WAITING_LIMIT,
  });

  const byMonth = new Map(raw.trend.map((r) => [r.month, r]));

  return {
    openClaims: raw.openClaims,
    needsAttention: raw.byStatus
      .filter((r) => needsAttention(r.status))
      .reduce((sum, r) => sum + r.count, 0),
    avgTimeInStageHours: raw.avgStageHours,
    settledThisMonth: raw.settledThisMonth,
    byStatus: raw.byStatus,
    settledTrend: months.map(({ year, month }) => {
      const key = `${year}-${String(month + 1).padStart(2, "0")}`;
      const hit = byMonth.get(key);
      return { year, month, count: hit?.count ?? 0, value: hit?.value ?? 0 };
    }),
    waiting: raw.waiting.map((w) => ({
      ...w,
      status: w.status as ClaimStatus,
      updatedAt: w.updatedAt.toISOString(),
    })),
  };
}

export async function getClaim(auth: AuthContext, id: string) {
  const claim = await claimsRepository.getClaimById(id);
  if (!claim) throw new ClaimNotFoundError(id);

  if (auth.role === "desk_executive") {
    const memberId = await getMemberId(auth.userId);
    if (claim.assignedTo !== memberId) throw new ClaimNotFoundError(id);
  }

  // Which stage the query interrupted, so the claim file can offer the one
  // move that will be accepted.
  if (claim.status === "QUERY_RAISED") {
    return {
      ...claim,
      queriedFrom: await claimsRepository.statusBeforeQuery(id),
    };
  }

  return { ...claim, queriedFrom: null };
}

/**
 * Captures the insurer/procedure's current checklist rules onto the claim
 * at the moment it's opened — see docs/adr/0001.
 */
export class PackageOnNonSchemeClaimError extends Error {}

export async function createClaim(auth: AuthContext, body: CreateClaimBody) {
  // A package belongs to a government scheme and to nothing else
  // (docs/adr/0012).
  const payer = await insurersRepository.getById(body.insurerId);
  const scheme = isSchemePayer(payer?.type);
  if (body.packageCode && !scheme) {
    throw new PackageOnNonSchemeClaimError(body.insurerId);
  }

  const checklistSnapshot = await getRequirementsSnapshot(
    body.insurerId,
    body.procedureId,
  );
  // Frozen for the same reason the checklist is (docs/adr/0001): an admin
  // reordering or removing a pre-auth field next month must not change what
  // this claim asked for.
  const preauthLayoutSnapshot = await preauthLayoutsService.resolveLayout(
    body.insurerId,
  );
  // Never onto the claim itself: `expectedCost` is what the hospital thinks
  // the admission will cost, and writing it to `billedAmount` made a draft
  // claim report a bill it had not raised — then left the pre-auth form's
  // own total blank, so the desk typed the same figure twice.
  const { expectedCost, ...claimFields } = body;

  const claim = await claimsRepository.createClaim(
    {
      ...claimFields,
      // The rate IS the sanctioned amount, written now rather than left
      // waiting on a decision the scheme has no reason to send
      // (docs/adr/0012).
      ...(body.packageRate !== undefined
        ? { sanctionedAmount: body.packageRate }
        : {}),
    },
    checklistSnapshot,
    preauthLayoutSnapshot,
  );

  // Confirmed on arrival: a human typed it on the form that opened the
  // claim, so it is not a suggestion waiting on a check (docs/adr/0005).
  if (expectedCost !== undefined) {
    await preauthRepository.confirm(
      claim.id,
      "totalExpectedCost",
      String(expectedCost),
      await getMemberId(auth.userId),
    );
  }

  await auditService.record(auth, {
    action: "claim.created",
    entityType: "claim",
    entityId: claim.id,
    after: {
      patientName: claim.patientName,
      status: claim.status,
      // Recorded on every claim, so "which claims were opened with no
      // checklist" is answerable afterwards rather than only noticeable at
      // the time.
      checklistRules: checklistSnapshot.length,
    },
  });

  if (checklistSnapshot.length === 0) {
    // Its own entry, because this is the quiet failure: a claim with no
    // checklist reports nothing missing for the rest of its life, and at
    // settlement that reads as a complete file.
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
 * Moves a claim, and stamps the clock the new status starts
 * (docs/adr/0004).
 */
export async function transitionClaimStatus(
  auth: AuthContext,
  claimId: string,
  nextStatus: ClaimStatus,
  slaDeadline: Date | undefined,
) {
  // Through `getClaim`, not the repository: docs/adr/0002 means the
  // assignment to be a boundary, not a filter on one screen.
  const claim = await getClaim(auth, claimId);

  if (!canTransition(claim.status, nextStatus, auth.role)) {
    throw new InvalidTransitionError(
      `${claim.status} -> ${nextStatus} not allowed for ${auth.role}`,
    );
  }

  // A query is answered by returning to the stage it interrupted.
  if (claim.status === "QUERY_RAISED") {
    // Already resolved by the read above.
    const queriedFrom = claim.queriedFrom;
    if (queriedFrom && nextStatus !== queriedFrom) {
      throw new InvalidTransitionError(
        `this query was raised at ${queriedFrom}, so it is answered by going back there, not to ${nextStatus}`,
      );
    }
  }

  // Settled is a claim about money arriving, so there has to be money — the
  // invariant `db:verify` asserts as "every settled claim records what it
  // was paid".
  if (nextStatus === "SETTLED" && claim.settledAmount === null) {
    throw new SettlementNotRecordedError(
      "record what the insurer paid before marking the claim settled",
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
    // What this whole function validated against.
    claim.status,
  );
  if (!updated) {
    // Gone, or moved. Worth one read to say which: "reload" is useless
    // for a claim that no longer exists.
    const current = await claimsRepository.getClaimById(claimId);
    if (!current) throw new ClaimNotFoundError(claimId);
    throw new ConcurrentTransitionError(
      `this claim is now at ${CLAIM_STATUS_LABEL[current.status]}, not ${CLAIM_STATUS_LABEL[claim.status]} — someone else has moved it, so reload before deciding again`,
    );
  }

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
 * confirmed document in that slot — the brief's "see at a glance what's
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
 * Adds one checklist slot to one claim, after it was opened
 * (docs/adr/0001).
 */
export async function addChecklistSlot(
  auth: AuthContext,
  claimId: string,
  documentType: string,
  /**
   * `required` is optional by default, and the default is the important
   * half: a slot added because a document turned up that fit nowhere is a
   * place to put something, not a demand from the insurer.
   */
  options: { required?: boolean; fromRules?: boolean } = {},
) {
  const required = options.required ?? false;
  const fromRules = options.fromRules ?? false;
  // Scopes to what this user may see, and a desk executive may do this on
  // their own claims — unlike a checklist *rule*, which reaches every
  // future claim for the pair and stays a desk head's call.
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

/** Takes a hand-added slot back off one claim (docs/adr/0001). */
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
 * Gives a claim the checklist it should have been opened with
 * (docs/adr/0001).
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

  // One at a time, through the same path the assistant uses, so each slot
  // gets its own audit entry and the "who added this" question has the same
  // answer however it arrived.
  for (const rule of rules) {
    await addChecklistSlot(auth, claimId, rule.documentType, {
      required: rule.required,
      // Marked as the insurer's requirement rather than someone's
      // judgement, so it is no more removable than one snapshotted at
      // creation.
      fromRules: true,
    });
  }

  return getClaim(auth, claimId);
}

/** Where one claim's money stands (docs/adr/0012). */
export async function getClaimFinancials(
  auth: AuthContext,
  claimId: string,
): Promise<ClaimFinancials> {
  // Scoped for the same reason as the transition above: the money on a
  // claim is the claim. An executive could read any of it.
  const claim = await getClaim(auth, claimId);

  const [preauthRows, deductionTotals, openEnhancement] = await Promise.all([
    preauthRepository.listForClaim(claimId),
    deductionsRepository.totalsForClaim(claimId),
    enhancementsRepository.getOpenForClaim(claimId),
  ]);

  // Only a confirmed value counts.
  const expectedRow = (preauthRows ?? []).find(
    (row) => row.fieldKey === "totalExpectedCost" && row.confirmedAt,
  );
  const expectedCost = expectedRow?.value ? Number(expectedRow.value) : null;

  const sanctionedAmount =
    claim.sanctionedAmount === null ? null : Number(claim.sanctionedAmount);
  const billedAmount =
    claim.billedAmount === null ? null : Number(claim.billedAmount);

  // The bill if there is one, otherwise what the desk expects to spend.
  const costOnRecord =
    billedAmount !== null && expectedCost !== null
      ? Math.max(billedAmount, expectedCost)
      : (billedAmount ?? expectedCost);

  // A shortfall needs both a ceiling and a bill.
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

/** Records the two amounts a claim is judged by. */
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

export class AssigneeNotFoundError extends Error {}

/** Hands a claim to someone on the desk, or back to the unassigned pool. */
export async function assignClaim(
  auth: AuthContext,
  claimId: string,
  assigneeId: string | null,
) {
  const claim = await claimsRepository.getClaimById(claimId);
  if (!claim) throw new ClaimNotFoundError(claimId);

  if (assigneeId !== null) {
    const assignee = await getMemberById(assigneeId);
    if (!assignee) throw new AssigneeNotFoundError(assigneeId);
  }

  const updated = await claimsRepository.assign(claimId, assigneeId);
  if (!updated) throw new ClaimNotFoundError(claimId);

  await auditService.record(auth, {
    action: "claim.assigned",
    entityType: "claim",
    entityId: claimId,
    before: { assignedTo: claim.assignedTo },
    after: { assignedTo: assigneeId },
    actorId: await getMemberId(auth.userId),
  });

  return updated;
}

/** Records a payment against a claim. */
export class PaymentExceedsBillError extends Error {}

export async function recordPayment(
  auth: AuthContext,
  claimId: string,
  body: RecordPaymentBody,
) {
  const claim = await getClaim(auth, claimId);

  // An insurer does not pay more than it was billed.
  const billed =
    claim.billedAmount === null ? null : Number(claim.billedAmount);
  if (billed !== null && body.settledAmount > billed) {
    throw new PaymentExceedsBillError(
      `${body.settledAmount.toLocaleString("en-IN")} is more than the ${billed.toLocaleString("en-IN")} billed`,
    );
  }

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
