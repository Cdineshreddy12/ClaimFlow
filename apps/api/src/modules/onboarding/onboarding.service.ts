import type { Role } from "@claimflow/contracts";
import * as auditService from "../audit/audit.service.js";
import { getOrgMemberId } from "../org-members/org-members.repository.js";
import * as onboardingRepository from "./onboarding.repository.js";
import type { InvitableRole } from "./onboarding.schema.js";

export class AlreadyOnboardedError extends Error {}
export class InviteNotFoundError extends Error {}
export class InviteExpiredError extends Error {}
export class InviteAlreadyUsedError extends Error {}

interface AuthContext {
  userId: string;
  organizationId: string;
  role: Role;
}

export async function createOrganization(userId: string, name: string) {
  const existing = await onboardingRepository.getOrgMembershipForUser(userId);
  if (existing) throw new AlreadyOnboardedError(userId);
  const result = await onboardingRepository.createOrganizationWithAdmin(
    userId,
    name,
  );

  await auditService.record(
    { organizationId: result.organization.id, userId },
    {
      action: "organization.created",
      entityType: "organization",
      entityId: result.organization.id,
      after: { name: result.organization.name },
      actorId: result.member.id,
    },
  );

  return result;
}

export async function createInvite(auth: AuthContext, role: InvitableRole) {
  // auth came from a verified org_members row (see authenticate.ts), so
  // this is never actually absent.
  const memberId = await getOrgMemberId(auth.organizationId, auth.userId);
  const invite = await onboardingRepository.createInvite(
    auth.organizationId,
    role,
    memberId!,
  );

  await auditService.record(auth, {
    action: "invite.created",
    entityType: "invite",
    entityId: invite.id,
    after: { role: invite.role, expiresAt: invite.expiresAt },
    actorId: memberId,
  });

  return invite;
}

export async function listInvites(auth: AuthContext) {
  return onboardingRepository.listInvites(auth.organizationId);
}

/** Public preview for the accept-invite screen — org name + role, before the invitee signs in. */
export async function previewInvite(token: string) {
  const row = await onboardingRepository.getInviteWithOrgName(token);
  if (!row) throw new InviteNotFoundError(token);
  if (row.invite.usedAt) throw new InviteAlreadyUsedError(token);
  if (row.invite.expiresAt < new Date()) throw new InviteExpiredError(token);
  return { organizationName: row.organizationName, role: row.invite.role };
}

export async function acceptInvite(token: string, userId: string) {
  const result = await onboardingRepository.redeemInvite(token, userId);
  if (result.ok) {
    await auditService.record(
      { organizationId: result.member.organizationId, userId },
      {
        action: "invite.accepted",
        entityType: "invite",
        entityId: null,
        after: { role: result.member.role },
        actorId: result.member.id,
      },
    );
    return result.member;
  }

  switch (result.reason) {
    case "not_found":
      throw new InviteNotFoundError(token);
    case "expired":
      throw new InviteExpiredError(token);
    case "used":
      throw new InviteAlreadyUsedError(token);
    case "already_member":
      throw new AlreadyOnboardedError(userId);
  }
}
