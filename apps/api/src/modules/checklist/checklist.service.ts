import * as checklistRepository from "./checklist.repository.js";
import type {
  CreateChecklistRuleBody,
  UpdateChecklistRuleBody,
} from "./checklist.schema.js";

export class RuleNotFoundError extends Error {}
export class DuplicateRuleError extends Error {}

interface AuthContext {
  organizationId: string;
}

export async function listRules(
  auth: AuthContext,
  insurerId: string,
  procedureId: string,
) {
  const [rules, activeClaims] = await Promise.all([
    checklistRepository.listRules(auth.organizationId, insurerId, procedureId),
    checklistRepository.countActiveClaimsFor(
      auth.organizationId,
      insurerId,
      procedureId,
    ),
  ]);
  return { rules, activeClaims };
}

export async function createRule(
  auth: AuthContext,
  body: CreateChecklistRuleBody,
) {
  try {
    return await checklistRepository.createRule(auth.organizationId, body);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new DuplicateRuleError(
        `a rule for "${body.documentType}" already exists on this insurer/procedure`,
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
  const updated = await checklistRepository.updateRule(
    auth.organizationId,
    id,
    body,
  );
  if (!updated) throw new RuleNotFoundError(id);
  return updated;
}

export async function deleteRule(auth: AuthContext, id: string) {
  const deleted = await checklistRepository.deleteRule(auth.organizationId, id);
  if (!deleted) throw new RuleNotFoundError(id);
}

/**
 * What claims.service.ts calls when a claim is created — captured once
 * and stored on the claim (claims.checklistSnapshot), never re-derived
 * live. See docs/adr/0001: editing the live rules later must not change
 * what an in-flight claim requires.
 */
export async function getRequirementsSnapshot(
  organizationId: string,
  insurerId: string,
  procedureId: string,
) {
  const rules = await checklistRepository.listRules(
    organizationId,
    insurerId,
    procedureId,
  );
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
