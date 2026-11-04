import { getOrgMemberId } from "../org-members/org-members.repository.js";
import * as auditRepository from "./audit.repository.js";

/**
 * Append-only record of who changed what, required by DPDP — see
 * docs/adr/0009.
 *
 * Two deliberate constraints on what gets written here:
 *
 * 1. Deltas, not row dumps. `before`/`after` carry only the fields that
 *    actually changed. Copying a whole claim row in would duplicate
 *    patient data into a second table for no extra forensic value, which
 *    is the opposite of what data-minimisation asks for.
 *
 * 2. Never throws. The mutation it describes has already committed by
 *    the time this runs, so raising here would report failure for work
 *    that actually succeeded. A failed write is logged loudly instead —
 *    see the caveat in docs/adr/0009 about making this transactional.
 */

export type AuditAction =
  | "claim.created"
  | "claim.status_changed"
  | "document.registered"
  | "document.confirmed"
  | "document.discarded"
  | "checklist_rule.created"
  | "checklist_rule.updated"
  | "checklist_rule.deleted"
  | "query.created"
  | "query.updated"
  | "query.replied"
  | "organization.created"
  | "organization.profile_updated"
  | "invite.created"
  | "invite.accepted"
  | "packet.generated"
  | "doctor_approval.requested"
  | "doctor_approval.viewed"
  | "doctor_approval.approved"
  | "doctor_approval.declined";

interface AuditContext {
  userId: string;
  organizationId: string;
}

interface RecordArgs {
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  /** Only passed by callers that already resolved it; otherwise looked up. */
  actorId?: string | null;
}

export async function record(
  auth: AuditContext,
  args: RecordArgs,
): Promise<void> {
  try {
    const actorId =
      args.actorId !== undefined
        ? args.actorId
        : await getOrgMemberId(auth.organizationId, auth.userId);

    await auditRepository.insert({
      organizationId: auth.organizationId,
      actorId,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      ...(args.before !== undefined ? { before: args.before } : {}),
      ...(args.after !== undefined ? { after: args.after } : {}),
    });
  } catch (err) {
    // Deliberately swallowed — see the header. Surfaced via console so it
    // reaches the process logs rather than vanishing.
    console.error("audit write failed", {
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function listAuditLog(
  auth: AuditContext,
  filters: { entityType?: string; entityId?: string; limit: number },
) {
  return auditRepository.listForOrganization(auth.organizationId, filters);
}
