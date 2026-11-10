import {
  documentNameKey,
  isSameDocument,
  proposalIsWorthShowing,
  type ChecklistProposal,
  type ChecklistProposalAction,
} from "@claimflow/contracts";
import * as auditService from "../audit/audit.service.js";
import * as checklistRepository from "./checklist.repository.js";
import type {
  CreateChecklistRuleBody,
  UpdateChecklistRuleBody,
} from "./checklist.schema.js";

export class RuleNotFoundError extends Error {}
export class DuplicateRuleError extends Error {}

interface AuthContext {
  // Needed to resolve the acting org_member for the audit trail; the routes
  // already pass the full authUser, this just stops widening it being
  // silently optional.
  userId: string;
}

export async function listRules(
  auth: AuthContext,
  insurerId: string,
  procedureId: string,
) {
  const [rules, activeClaims] = await Promise.all([
    checklistRepository.listRules(insurerId, procedureId),
    checklistRepository.countActiveClaimsFor(insurerId, procedureId),
  ]);
  return { rules, activeClaims };
}

/**
 * Which insurer/procedure pairs the desk works on, and which of them have
 * no checklist at all.
 */
export async function getCoverage(_auth: AuthContext) {
  const rows = await checklistRepository.listCoverage();
  const uncovered = rows.filter((row) => row.rules === 0);

  return {
    // Worst first: most claims on no checklist at all.
    uncovered: uncovered.sort((a, b) => b.claims - a.claims),
    covered: rows
      .filter((row) => row.rules > 0)
      .sort((a, b) => b.claims - a.claims),
    uncoveredClaims: uncovered.reduce((sum, row) => sum + row.claims, 0),
  };
}

export async function createRule(
  auth: AuthContext,
  body: CreateChecklistRuleBody,
) {
  try {
    const rule = await checklistRepository.createRule(body);
    await auditService.record(auth, {
      action: "checklist_rule.created",
      entityType: "checklist_rule",
      entityId: rule.id,
      after: { documentType: rule.documentType, required: rule.required },
    });
    return rule;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new DuplicateRuleError(
        `A rule for "${body.documentType}" already exists on this insurer and procedure`,
      );
    }
    throw err;
  }
}

export async function updateRule(
  auth: AuthContext,
  id: string,
  body: UpdateChecklistRuleBody,
) {
  const updated = await checklistRepository.updateRule(id, body);
  if (!updated) throw new RuleNotFoundError(id);

  await auditService.record(auth, {
    action: "checklist_rule.updated",
    entityType: "checklist_rule",
    entityId: id,
    after: { documentType: updated.documentType, required: updated.required },
  });

  return updated;
}

export async function deleteRule(auth: AuthContext, id: string) {
  const deleted = await checklistRepository.deleteRule(id);
  if (!deleted) throw new RuleNotFoundError(id);

  await auditService.record(auth, {
    action: "checklist_rule.deleted",
    entityType: "checklist_rule",
    entityId: id,
    before: { documentType: deleted.documentType, required: deleted.required },
  });
}

/**
 * What claims.service.ts calls when a claim is created — captured once and
 * stored on the claim (claims.checklistSnapshot), never re-derived live
 * (docs/adr/0001).
 */
export async function getRequirementsSnapshot(
  insurerId: string,
  procedureId: string,
) {
  const rules = await checklistRepository.listRules(insurerId, procedureId);
  return rules.map((rule) => ({
    documentType: rule.documentType,
    required: rule.required,
  }));
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

/**
 * Checklist rules the insurers' own queries say are missing
 * (docs/adr/0016).
 */
export async function proposeRules(
  // Unused: this reads nothing tenant-scoped and writes no audit row.
  _auth: AuthContext,
): Promise<ChecklistProposal[]> {
  const [requested, rules] = await Promise.all([
    checklistRepository.requestedItemsByPair(),
    checklistRepository.listAllRules(),
  ]);

  // Variants of one document name collapse into a single proposal: "Copy of
  // discharge summary" and "Discharge summaries" are one slot the insurer
  // keeps asking for, not two.
  const grouped = new Map<
    string,
    {
      row: (typeof requested)[number];
      variants: Set<string>;
      claimsRequested: number;
    }
  >();

  for (const row of requested) {
    const key = `${row.insurerId}:${row.procedureId}:${documentNameKey(row.requestedItem)}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.variants.add(row.requestedItem);
      // The same claim can't appear under two spellings of one item in
      // this aggregate, so these add rather than max.
      existing.claimsRequested += row.claimsRequested;
    } else {
      grouped.set(key, {
        row,
        variants: new Set([row.requestedItem]),
        claimsRequested: row.claimsRequested,
      });
    }
  }

  const proposals: ChecklistProposal[] = [];

  for (const group of grouped.values()) {
    const { row } = group;
    // Never propose more claims than were submitted: two spellings of one
    // item on different claims can sum past the denominator, and a rate
    // above 100% would discredit the whole list.
    const claimsRequested = Math.min(
      group.claimsRequested,
      row.claimsSubmitted,
    );
    if (
      !proposalIsWorthShowing({
        claimsRequested,
        claimsSubmitted: row.claimsSubmitted,
      })
    ) {
      continue;
    }

    const pairRules = rules.filter(
      (rule) =>
        rule.insurerId === row.insurerId &&
        rule.procedureId === row.procedureId,
    );
    const match = pairRules.find((rule) =>
      isSameDocument(rule.documentType, row.requestedItem),
    );

    // Already required: the checklist is right and the insurer is asking
    // for something the desk failed to attach.
    if (match?.required) continue;

    proposals.push({
      insurerId: row.insurerId,
      insurerName: row.insurerName,
      procedureId: row.procedureId,
      procedureName: row.procedureName,
      // The existing slot's wording wins when there is one, so accepting
      // a proposal can never create a near-duplicate rule.
      documentType: match?.documentType ?? row.requestedItem,
      requestedAs: [...group.variants].filter(
        (variant) => variant !== (match?.documentType ?? row.requestedItem),
      ),
      claimsRequested,
      claimsSubmitted: row.claimsSubmitted,
      action: match ? "make_required" : "add_required",
    });
  }

  return proposals.sort(
    (a, b) =>
      b.claimsRequested / b.claimsSubmitted -
      a.claimsRequested / a.claimsSubmitted,
  );
}

/** Accepts one proposal. */
export async function applyProposal(
  auth: AuthContext,
  proposal: {
    insurerId: string;
    procedureId: string;
    documentType: string;
    action: ChecklistProposalAction;
  },
) {
  if (proposal.action === "make_required") {
    const pairRules = await checklistRepository.listRules(
      proposal.insurerId,
      proposal.procedureId,
    );
    const existing = pairRules.find(
      (rule) => rule.documentType === proposal.documentType,
    );
    if (!existing) throw new RuleNotFoundError(proposal.documentType);

    const updated = await checklistRepository.updateRule(existing.id, {
      required: true,
    });
    if (!updated) throw new RuleNotFoundError(existing.id);

    await auditService.record(auth, {
      action: "checklist_rule.proposal_applied",
      entityType: "checklist_rule",
      entityId: updated.id,
      before: { required: false },
      after: { documentType: updated.documentType, required: true },
    });
    return updated;
  }

  const created = await createRule(auth, {
    insurerId: proposal.insurerId,
    procedureId: proposal.procedureId,
    documentType: proposal.documentType,
    required: true,
  });

  await auditService.record(auth, {
    action: "checklist_rule.proposal_applied",
    entityType: "checklist_rule",
    entityId: created.id,
    after: { documentType: created.documentType, required: true },
  });
  return created;
}
