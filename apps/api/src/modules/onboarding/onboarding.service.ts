import type { Role } from "@claimflow/contracts";
import * as auditService from "../audit/audit.service.js";
import { getMemberId } from "../members/members.repository.js";
import * as onboardingRepository from "./onboarding.repository.js";
import type { InvitableRole } from "./onboarding.schema.js";

export class AlreadyOnboardedError extends Error {}
/** One hospital per install — setup is a once-per-deployment action. */
export class HospitalAlreadySetUpError extends Error {}
export class InviteNotFoundError extends Error {}
export class InviteExpiredError extends Error {}
export class InviteAlreadyUsedError extends Error {}

interface AuthContext {
  userId: string;
  role: Role;
}

/** Claims the install for one hospital and makes the caller its admin. */
export async function setUpHospital(userId: string, name: string) {
  const existing = await onboardingRepository.getMembershipForUser(userId);
  if (existing) throw new AlreadyOnboardedError(userId);
  if (await onboardingRepository.hasAnyMember()) {
    throw new HospitalAlreadySetUpError();
  }

  const result = await onboardingRepository.setUpHospital(userId, name);

  await auditService.record(
    { userId },
    {
      action: "hospital.created",
      entityType: "hospital",
      entityId: result.hospital.id,
      after: { name: result.hospital.name },
      actorId: result.member.id,
    },
  );

  return result;
}

export async function createInvite(auth: AuthContext, role: InvitableRole) {
  // auth came from a verified `members` row (see authenticate.ts), so
  // this is never actually absent.
  const memberId = await getMemberId(auth.userId);
  const invite = await onboardingRepository.createInvite(role, memberId!);

  await auditService.record(auth, {
    action: "invite.created",
    entityType: "invite",
    entityId: invite.id,
    after: { role: invite.role, expiresAt: invite.expiresAt },
    actorId: memberId,
  });

  return invite;
}

export async function listInvites(_auth: AuthContext) {
  return onboardingRepository.listInvites();
}

/** Public preview for the accept-invite screen — hospital name + role, before the invitee signs in. */
export async function previewInvite(token: string) {
  const row = await onboardingRepository.getInviteWithHospitalName(token);
  if (!row) throw new InviteNotFoundError(token);
  if (row.invite.usedAt) throw new InviteAlreadyUsedError(token);
  if (row.invite.expiresAt < new Date()) throw new InviteExpiredError(token);
  return { hospitalName: row.hospitalName, role: row.invite.role };
}

export async function acceptInvite(token: string, userId: string) {
  const result = await onboardingRepository.redeemInvite(token, userId);
  if (result.ok) {
    await auditService.record(
      { userId },
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
