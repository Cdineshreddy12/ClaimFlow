import { getMemberId } from "../members/members.repository.js";
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
  | "query.deadline_confirmed"
  | "query.resummarised"
  | "custom_module.created"
  | "custom_module.updated"
  | "custom_module.retired"
  | "custom_module.reactivated"
  | "custom_module.deleted"
  | "custom_module.field_added"
  | "custom_module.field_removed"
  | "custom_record.created"
  | "custom_record.updated"
  | "custom_record.deleted"
  | "procedure.created"
  | "procedure.updated"
  | "procedure.retired"
  | "procedure.reactivated"
  | "procedure.deleted"
  | "insurer.created"
  | "insurer.updated"
  | "insurer.retired"
  | "insurer.reactivated"
  | "insurer.deleted"
  | "claim.payment_recorded"
  | "hospital.created"
  | "hospital.profile_updated"
  | "invite.created"
  | "invite.accepted"
  | "preauth_layout.updated"
  | "preauth_field.created"
  | "preauth_field.deleted"
  | "preauth.extracted"
  | "preauth.form_printed"
  | "preauth.field_confirmed"
  | "preauth.field_cleared"
  | "packet.generated"
  | "doctor_approval.requested"
  | "doctor_approval.viewed"
  | "doctor_approval.approved"
  | "doctor_approval.declined"
  | "deduction.recorded"
  | "deduction.contested"
  | "deduction.appeal_resolved"
  | "claim.financials_updated"
  | "claim.checklist_slot_added"
  | "claim.checklist_slot_removed"
  | "claim.opened_without_checklist"
  | "enhancement.requested"
  | "enhancement.decided"
  | "checklist_rule.proposal_applied"
  /**
   * Provenance, not a separate write. The action itself is audited by
   * whichever service performed it; this records that a human approved
   * it from an assistant card rather than typing it — the only way to
   * tell afterwards which decisions started as a model's suggestion.
   */
  | "assistant.proposal_approved";

interface AuditContext {
  userId: string;
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
        : await getMemberId(auth.userId);

    await auditRepository.insert({
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
  return auditRepository.list(filters);
}
