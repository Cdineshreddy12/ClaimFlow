import { config } from "dotenv";
config({ path: "../../.env" });

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { organizations } from "../../db/schema.js";
import * as onboardingRepository from "./onboarding.repository.js";

describe.skipIf(!process.env.DATABASE_URL)(
  "onboarding.repository (integration)",
  () => {
    const createdOrgIds: string[] = [];

    afterEach(async () => {
      for (const id of createdOrgIds.splice(0)) {
        await db.delete(organizations).where(eq(organizations.id, id));
      }
    });

    it("creates an organization with a 14-day trial and an org_admin membership", async () => {
      const userId = crypto.randomUUID();
      const { organization, member } =
        await onboardingRepository.createOrganizationWithAdmin(
          userId,
          "Trial Hospital",
        );
      createdOrgIds.push(organization.id);

      expect(organization.slug).toMatch(/^trial-hospital/);
      expect(member.role).toBe("org_admin");
      expect(member.userId).toBe(userId);

      const trialMs = organization.trialEndsAt!.getTime() - Date.now();
      const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
      expect(Math.abs(trialMs - fourteenDaysMs)).toBeLessThan(60_000);

      const membership =
        await onboardingRepository.getOrgMembershipForUser(userId);
      expect(membership?.organizationId).toBe(organization.id);
    });

    it("appends a numeric suffix when the slug is already taken", async () => {
      const first = await onboardingRepository.createOrganizationWithAdmin(
        crypto.randomUUID(),
        "Slug Collision Hospital",
      );
      createdOrgIds.push(first.organization.id);

      const second = await onboardingRepository.createOrganizationWithAdmin(
        crypto.randomUUID(),
        "Slug Collision Hospital",
      );
      createdOrgIds.push(second.organization.id);

      expect(first.organization.slug).toBe("slug-collision-hospital");
      expect(second.organization.slug).toBe("slug-collision-hospital-1");
    });

    it("creates an invite, previews it by token, and redeems it into a real membership", async () => {
      const { organization, member } =
        await onboardingRepository.createOrganizationWithAdmin(
          crypto.randomUUID(),
          "Invite Flow Hospital",
        );
      createdOrgIds.push(organization.id);

      const invite = await onboardingRepository.createInvite(
        organization.id,
        "desk_executive",
        member.id,
      );
      expect(invite.usedAt).toBeNull();

      const preview = await onboardingRepository.getInviteWithOrgName(
        invite.token,
      );
      expect(preview?.organizationName).toBe("Invite Flow Hospital");
      expect(preview?.invite.role).toBe("desk_executive");

      const inviteeId = crypto.randomUUID();
      const redeemed = await onboardingRepository.redeemInvite(
        invite.token,
        inviteeId,
      );
      expect(redeemed.ok).toBe(true);
      if (redeemed.ok) {
        expect(redeemed.member.role).toBe("desk_executive");
        expect(redeemed.member.organizationId).toBe(organization.id);
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
      const { organization, member } =
        await onboardingRepository.createOrganizationWithAdmin(
          crypto.randomUUID(),
          "Used Invite Hospital",
        );
      createdOrgIds.push(organization.id);

      const invite = await onboardingRepository.createInvite(
        organization.id,
        "doctor",
        member.id,
      );
      const firstUserId = crypto.randomUUID();
      await onboardingRepository.redeemInvite(invite.token, firstUserId);

      const result = await onboardingRepository.redeemInvite(
        invite.token,
        crypto.randomUUID(),
      );
      expect(result).toEqual({ ok: false, reason: "used" });
    });

    it("rejects redeeming when the user already belongs to an organization", async () => {
      const { organization, member } =
        await onboardingRepository.createOrganizationWithAdmin(
          crypto.randomUUID(),
          "Already Member Hospital",
        );
      createdOrgIds.push(organization.id);

      const invite = await onboardingRepository.createInvite(
        organization.id,
        "desk_head",
        member.id,
      );

      // member.userId already has an org_members row (the org_admin one).
      const result = await onboardingRepository.redeemInvite(
        invite.token,
        member.userId,
      );
      expect(result).toEqual({ ok: false, reason: "already_member" });
    });
  },
);
