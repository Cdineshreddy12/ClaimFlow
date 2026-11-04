import { z } from "zod";

export const CreateOrganizationBody = z.object({
  name: z.string().min(1).max(200),
});
export type CreateOrganizationBody = z.infer<typeof CreateOrganizationBody>;

/**
 * Deliberately narrower than the full Role enum — an org_admin invites
 * their own staff, never another org_admin and never platform_admin
 * (that would be a privilege-escalation path straight through the invite
 * link). Matches docs/adr/0006's wording exactly.
 */
export const InvitableRole = z.enum(["desk_head", "desk_executive", "doctor"]);
export type InvitableRole = z.infer<typeof InvitableRole>;

export const CreateInviteBody = z.object({
  role: InvitableRole,
});
export type CreateInviteBody = z.infer<typeof CreateInviteBody>;

export const InviteTokenParams = z.object({
  token: z.string().min(1),
});
