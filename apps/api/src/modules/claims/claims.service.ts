import {
  adviseEnhancement,
  canTransition,
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
 * the org half). desk_head and everyone above sees the full org.
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

/**
 * One page of claims, with the total behind it.
 *
 * The desk's list screen is the one place a hospital's whole history
 * accumulates, and it used to fetch all of it and filter in the
 * browser. Callers that genuinely want every claim — the dashboard's
 * charts, the assistant's claim-matching — go through `listClaims`
 * above and send no limit.
 *
 * The scoping rule is unchanged and still comes first: a desk
 * executive sees their own claims whatever else they ask for
 * (docs/adr/0002).
 */
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

/**
 * The dashboard, counted rather than fetched.
 *
 * Replaces "send every claim and let the browser work it out". The
 * month boundary and the six-month window are decided here, on the
 * server's clock — the browser's was fine while the browser did the
 * counting, and is not once the counting moves.
 *
 * Empty months are filled in afterwards so the trend chart has six
 * columns whatever the data looks like; a chart that silently drops a
 * quiet month reads as a shorter history rather than a quieter one.
 */
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

  /*
    Which stage the query interrupted, so the claim file can offer the
    one move that will be accepted.

    The transition table lists both stages a query can be answered
    into, because a query can be raised at either; only the history
    says which applies here. Without this the file would render two
    buttons, one of which is a 422 waiting to happen.
  */
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
 * at the moment it's opened — see docs/adr/0001. Whatever the checklist
 * admin edits afterward never reaches back into claims already in flight.
 */
export class PackageOnNonSchemeClaimError extends Error {}

export async function createClaim(auth: AuthContext, body: CreateClaimBody) {
  /*
    A package belongs to a government scheme and to nothing else.

    The schema can see that both fields arrived together; only here is
    the payer known. Accepting a package rate on a private claim would
    put a number in `sanctionedAmount` that no insurer ever sanctioned
    — the one field docs/adr/0012's whole shortfall model is measured
    against.
  */
  const payer = await insurersRepository.getById(body.insurerId);
  const scheme = isSchemePayer(payer?.type);
  if (body.packageCode && !scheme) {
    throw new PackageOnNonSchemeClaimError(body.insurerId);
  }

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
  // Never onto the claim itself: `expectedCost` is what the hospital
  // thinks the admission will cost, and writing it to `billedAmount`
  // made a draft claim report a bill it had not raised — then left the
  // pre-auth form's own total blank, so the desk typed the same figure
  // twice.
  const { expectedCost, ...claimFields } = body;

  const claim = await claimsRepository.createClaim(
    {
      ...claimFields,
      /*
        The rate IS the sanctioned amount, written now rather than left
        waiting on a decision the scheme has no reason to send.

        On a private claim the hospital states a cost and the insurer
        answers with a sanctioned amount, and the gap between them is
        the subject of docs/adr/0012. A scheme answers before it is
        asked: the package says what it pays. Leaving the field null
        would show "Sanctioned: —" on a claim whose worth was never in
        doubt, and send a desk looking for an answer that never comes.
      */
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
  /*
    Through `getClaim`, not the repository, so a desk executive is held
    to the claims assigned to them.

    This read the claim raw. An executive could not open someone else's
    claim and could still move it — send its pre-auth, approve it, bill
    it, reject it — because the scoping lived in the read path and this
    was not on it. docs/adr/0002 means the assignment to be a boundary,
    not a filter on one screen.
  */
  const claim = await getClaim(auth, claimId);

  if (!canTransition(claim.status, nextStatus, auth.role)) {
    throw new InvalidTransitionError(
      `${claim.status} -> ${nextStatus} not allowed for ${auth.role}`,
    );
  }

  /*
    A query is answered by returning to the stage it interrupted.

    The table has to list both stages a query can be raised at, which
    on its own would let a pre-auth query be answered into
    FINAL_BILL_SUBMITTED and skip approval entirely. The claim's own
    history is what decides, so it is checked here rather than widened
    into a table that cannot see it.
  */
  if (claim.status === "QUERY_RAISED") {
    // Already resolved by the read above.
    const queriedFrom = claim.queriedFrom;
    if (queriedFrom && nextStatus !== queriedFrom) {
      throw new InvalidTransitionError(
        `this query was raised at ${queriedFrom}, so it is answered by going back there, not to ${nextStatus}`,
      );
    }
  }

  /*
    Settled means the money arrived, so there has to be money.

    Nothing checked, and the UI offered the button whether or not a
    payment had been recorded -- so a claim could sit at SETTLED with a
    bill, no settled amount and no settlement date. `db:verify` has
    always asserted the opposite ("every settled claim records what it
    was paid"); the service simply did not, and the demo data grew a
    claim in exactly that state.

    The desk is not sent here to find out: the settle button opens the
    payment dialog and does both in one step. This is the backstop for
    the API being called directly, and for the dialog's second half
    failing after its first half succeeded.
  */
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
  // Scoped for the same reason as the transition above: the money on a
  // claim is the claim. An executive could read any of it.
  const claim = await getClaim(auth, claimId);

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

export class AssigneeNotFoundError extends Error {}

/**
 * Hands a claim to someone on the desk, or back to the unassigned pool.
 *
 * This is the write half of a scoping rule that shipped with only its
 * read half: `claims.assigned_to` has always decided what a desk
 * executive can see, and nothing in the product could set it. A role
 * scoped to its own claims, with no way to be given any, saw an empty
 * desk on every screen.
 *
 * Restricted to the roles that run the desk, not because assignment is
 * dangerous, but because deciding who works what is their job — an
 * executive reassigning a claim to themselves would route around it.
 *
 * Any member can hold a claim. A desk head carrying a few difficult
 * ones personally is ordinary, so this checks that the assignee exists
 * rather than what their role is.
 */
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

/**
 * Records a payment against a claim.
 *
 * Goes through getClaim so desk_executive scoping applies — an exec
 * can't record money against someone else's claim. Does not change
 * status: a payment can land before or after the desk marks a claim
 * settled, and forcing the order would make one of those impossible.
 */
export class PaymentExceedsBillError extends Error {}

export async function recordPayment(
  auth: AuthContext,
  claimId: string,
  body: RecordPaymentBody,
) {
  const claim = await getClaim(auth, claimId);

  /*
    An insurer does not pay more than it was billed.

    The amount was checked for being a number, under a hundred million
    and not dated in the future, and never against the claim it was
    being recorded on. A typo therefore landed in `settled_amount` and
    flowed straight into settled value, the ageing report and every
    recovery figure, and the first complaint came from `db:verify`
    long afterwards.

    Only when the bill is known, and measured against the bill rather
    than the sanction: an insurer can pay less than it sanctioned, and
    often does, but a payment above the bill is an error in the typing
    rather than a windfall.
  */
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
