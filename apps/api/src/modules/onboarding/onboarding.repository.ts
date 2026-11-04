import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { invites, orgMembers, organizations } from "../../db/schema.js";
import type { InvitableRole } from "./onboarding.schema.js";

const TRIAL_DAYS = 14;
const INVITE_EXPIRY_DAYS = 7;

/** Lowercase, hyphenated, no leading/trailing hyphens — "City General Hospital" -> "city-general-hospital". */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function getOrgMembershipForUser(userId: string) {
  const [member] = await db
    .select()
    .from(orgMembers)
    .where(eq(orgMembers.userId, userId));
  return member;
}

/**
 * Creates the organization and its first org_admin membership together —
 * either both exist or neither does, there's no valid in-between state
 * for a signed-up user. Slug uniqueness is resolved inside the
 * transaction so two hospitals signing up with the same name at the same
 * moment can't collide.
 */
export async function createOrganizationWithAdmin(
  userId: string,
  name: string,
) {
  const baseSlug = slugify(name) || "hospital";
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  return db.transaction(async (tx) => {
    let slug = baseSlug;
    let suffix = 0;
    while (suffix < 50) {
      const [existing] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, slug));
      if (!existing) break;
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }

    const [organization] = await tx
      .insert(organizations)
      .values({ name, slug, trialEndsAt })
      .returning();
    if (!organization) throw new Error("failed to create organization");

    const [member] = await tx
      .insert(orgMembers)
      .values({ organizationId: organization.id, userId, role: "org_admin" })
      .returning();
    if (!member) throw new Error("failed to create org_admin membership");

    return { organization, member };
  });
}

export async function createInvite(
  organizationId: string,
  role: InvitableRole,
  createdByMemberId: string,
) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );
  const [invite] = await db
    .insert(invites)
    .values({
      organizationId,
      role,
      token,
      createdBy: createdByMemberId,
      expiresAt,
    })
    .returning();
  // We just inserted exactly one row — this is never actually absent.
  return invite!;
}

export async function listInvites(organizationId: string) {
  return db
    .select()
    .from(invites)
    .where(eq(invites.organizationId, organizationId));
}

/** Joins the organization's name on — the accept-invite preview screen needs it, and invites alone don't carry it. */
export async function getInviteWithOrgName(token: string) {
  const [row] = await db
    .select({ invite: invites, organizationName: organizations.name })
    .from(invites)
    .innerJoin(organizations, eq(invites.organizationId, organizations.id))
    .where(eq(invites.token, token));
  return row;
}

export type RedeemInviteResult =
  | { ok: true; member: typeof orgMembers.$inferSelect }
  | { ok: false; reason: "not_found" | "expired" | "used" | "already_member" };

export async function redeemInvite(
  token: string,
  userId: string,
): Promise<RedeemInviteResult> {
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(invites)
      .where(eq(invites.token, token));
    if (!invite) return { ok: false, reason: "not_found" };
    if (invite.usedAt) return { ok: false, reason: "used" };
    if (invite.expiresAt < new Date()) return { ok: false, reason: "expired" };

    const [existingMembership] = await tx
      .select({ id: orgMembers.id })
      .from(orgMembers)
      .where(eq(orgMembers.userId, userId));
    if (existingMembership) return { ok: false, reason: "already_member" };

    const [member] = await tx
      .insert(orgMembers)
      .values({
        organizationId: invite.organizationId,
        userId,
        role: invite.role,
      })
      .returning();
    if (!member) throw new Error("failed to create membership from invite");

    await tx
      .update(invites)
      .set({ usedAt: new Date(), usedById: userId })
      .where(eq(invites.id, invite.id));

    return { ok: true, member };
  });
}
