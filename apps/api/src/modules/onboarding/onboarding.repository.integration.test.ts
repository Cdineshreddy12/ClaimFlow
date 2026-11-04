import { config } from "dotenv";
config({ path: "../../.env" });

import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { invites, members } from "../../db/schema.js";
import * as onboardingRepository from "./onboarding.repository.js";

/**
 * The trial-length and slug-collision tests that used to live here went
 * with multi-tenancy: there is no slug and no per-tenant trial any more,
 * and no second organization to collide with. What's left is the invite
 * flow, which is how everyone after the first person gets an account.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "onboarding.repository (integration)",
  () => {
    const createdMemberIds: string[] = [];
    const createdInviteIds: string[] = [];
    let adminMemberId: string;

    beforeAll(async () => {
      // The install may already be claimed — by the migration, the seed,
      // or an earlier run. Either way there is exactly one hospital, so
      // take it rather than making another.
      if (!(await onboardingRepository.hasAnyMember())) {
        const { member } = await onboardingRepository.setUpHospital(
          crypto.randomUUID(),
          "Integration Test Hospital",
        );
        adminMemberId = member.id;
        createdMemberIds.push(member.id);
        return;
      }
      const [existing] = await db.select().from(members).limit(1);
      if (existing) {
        adminMemberId = existing.id;
        return;
      }
      const [created] = await db
        .insert(members)
        .values({ userId: crypto.randomUUID(), role: "org_admin" })
        .returning();
      adminMemberId = created!.id;
      createdMemberIds.push(created!.id);
    });

    afterEach(async () => {
      const inviteIds = createdInviteIds.splice(0);
      if (inviteIds.length > 0) {
        await db.delete(invites).where(inArray(invites.id, inviteIds));
      }
      // Keep the admin row — later tests in this file still need it.
      const memberIds = createdMemberIds
        .splice(0)
        .filter((id) => id !== adminMemberId);
      if (memberIds.length > 0) {
        await db.delete(members).where(inArray(members.id, memberIds));
      }
    });

    it("creates an invite, previews it by token, and redeems it into a membership", async () => {
      const invite = await onboardingRepository.createInvite(
        "desk_executive",
        adminMemberId,
      );
      createdInviteIds.push(invite.id);
      expect(invite.usedAt).toBeNull();

      const preview = await onboardingRepository.getInviteWithHospitalName(
        invite.token,
      );
      expect(preview?.hospitalName).toBeTruthy();
      expect(preview?.invite.role).toBe("desk_executive");

      const redeemed = await onboardingRepository.redeemInvite(
        invite.token,
        crypto.randomUUID(),
      );
      expect(redeemed.ok).toBe(true);
      if (redeemed.ok) {
        createdMemberIds.push(redeemed.member.id);
        expect(redeemed.member.role).toBe("desk_executive");
      }
    });

    it("rejects redeeming an unknown token", async () => {
      const result = await onboardingRepository.redeemInvite(
        "not-a-real-token",
        crypto.randomUUID(),
      );
      expect(result).toEqual({ ok: false, reason: "not_found" });
    });

    it("rejects redeeming an already-used invite", async () => {
      const invite = await onboardingRepository.createInvite(
        "doctor",
        adminMemberId,
      );
      createdInviteIds.push(invite.id);

      const first = await onboardingRepository.redeemInvite(
        invite.token,
        crypto.randomUUID(),
      );
      if (first.ok) createdMemberIds.push(first.member.id);

      const second = await onboardingRepository.redeemInvite(
        invite.token,
        crypto.randomUUID(),
      );
      expect(second).toEqual({ ok: false, reason: "used" });
    });

    it("rejects redeeming when the user already has an account", async () => {
      const invite = await onboardingRepository.createInvite(
        "desk_head",
        adminMemberId,
      );
      createdInviteIds.push(invite.id);

      const [admin] = await db
        .select()
        .from(members)
        .where(eq(members.id, adminMemberId));

      const result = await onboardingRepository.redeemInvite(
        invite.token,
        admin!.userId,
      );
      expect(result).toEqual({ ok: false, reason: "already_member" });
    });
  },
);
