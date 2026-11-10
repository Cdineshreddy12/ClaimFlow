import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { hospitalProfile, invites, members } from "../../db/schema.js";
import type { InvitableRole } from "./onboarding.schema.js";

const INVITE_EXPIRY_DAYS = 7;

export async function getMembershipForUser(userId: string) {
  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.userId, userId));
  return member;
}

/**
 * Whether anyone has claimed this install yet.
 *
 * Deliberately "are there any members", not "is there a hospital row":
 * a hospital with no one able to sign into it would lock the install.
 */
export async function hasAnyMember(): Promise<boolean> {
  const [row] = await db.select({ id: members.id }).from(members).limit(1);
  return Boolean(row);
}

/**
 * Claims the install: the hospital row and its first admin, together or
 * neither.
 */
export async function setUpHospital(userId: string, name: string) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(hospitalProfile).limit(1);
    const hospital =
      existing ??
      (await tx.insert(hospitalProfile).values({ name }).returning())[0];
    if (!hospital) throw new Error("failed to create the hospital profile");

    const [member] = await tx
      .insert(members)
      .values({ userId, role: "org_admin" })
      .returning();
    if (!member) throw new Error("failed to create the first admin");

    return { hospital, member };
  });
}

export async function createInvite(
  role: InvitableRole,
  createdByMemberId: string,
) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );
  const [invite] = await db
    .insert(invites)
    .values({ role, token, createdBy: createdByMemberId, expiresAt })
    .returning();
  // We just inserted exactly one row — this is never actually absent.
  return invite!;
}

export async function listInvites() {
  return db.select().from(invites);
}

/** Joins the hospital's name on — the accept-invite preview needs it, and invites don't carry it. */
export async function getInviteWithHospitalName(token: string) {
  const [invite] = await db
    .select()
    .from(invites)
    .where(eq(invites.token, token));
  if (!invite) return undefined;
  const [hospital] = await db
    .select({ name: hospitalProfile.name })
    .from(hospitalProfile)
    .limit(1);
  return { invite, hospitalName: hospital?.name ?? "" };
}

export type RedeemInviteResult =
  | { ok: true; member: typeof members.$inferSelect }
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
      .select({ id: members.id })
      .from(members)
      .where(eq(members.userId, userId));
    if (existingMembership) return { ok: false, reason: "already_member" };

    const [member] = await tx
      .insert(members)
      .values({ userId, role: invite.role })
      .returning();
    if (!member) throw new Error("failed to create membership from invite");

    await tx
      .update(invites)
      .set({ usedAt: new Date(), usedById: userId })
      .where(eq(invites.id, invite.id));

    return { ok: true, member };
  });
}
