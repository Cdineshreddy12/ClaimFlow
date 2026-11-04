import { beforeEach, describe, expect, it, vi } from "vitest";
import * as onboardingRepository from "./onboarding.repository.js";
import * as orgMembersRepository from "../org-members/org-members.repository.js";

vi.mock("./onboarding.repository.js");
vi.mock("../org-members/org-members.repository.js");

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const MEMBER_ID = "33333333-3333-3333-3333-333333333333";
const TOKEN = "some-invite-token";

function auth(role: "org_admin" | "desk_head" = "org_admin") {
  return { userId: USER_ID, organizationId: ORG_ID, role };
}

describe("onboarding.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createOrganization", () => {
    it("raises AlreadyOnboardedError when the user already has a membership", async () => {
      vi.mocked(onboardingRepository.getOrgMembershipForUser).mockResolvedValue(
        { id: MEMBER_ID } as never,
      );

      const { createOrganization, AlreadyOnboardedError } =
        await import("./onboarding.service.js");

      await expect(createOrganization(USER_ID, "New Hospital")).rejects.toThrow(
        AlreadyOnboardedError,
      );
      expect(
        onboardingRepository.createOrganizationWithAdmin,
      ).not.toHaveBeenCalled();
    });

    it("creates the organization when the user has no membership yet", async () => {
      vi.mocked(onboardingRepository.getOrgMembershipForUser).mockResolvedValue(
        undefined,
      );
      vi.mocked(
        onboardingRepository.createOrganizationWithAdmin,
      ).mockResolvedValue({ organization: {}, member: {} } as never);

      const { createOrganization } = await import("./onboarding.service.js");
      await createOrganization(USER_ID, "New Hospital");

      expect(
        onboardingRepository.createOrganizationWithAdmin,
      ).toHaveBeenCalledWith(USER_ID, "New Hospital");
    });
  });

  describe("createInvite", () => {
    it("resolves the caller's own member id and passes it as createdBy", async () => {
      vi.mocked(orgMembersRepository.getOrgMemberId).mockResolvedValue(
        MEMBER_ID,
      );
      vi.mocked(onboardingRepository.createInvite).mockResolvedValue(
        {} as never,
      );

      const { createInvite } = await import("./onboarding.service.js");
      await createInvite(auth(), "desk_executive");

      expect(onboardingRepository.createInvite).toHaveBeenCalledWith(
        ORG_ID,
        "desk_executive",
        MEMBER_ID,
      );
    });
  });

  describe("previewInvite", () => {
    it("raises InviteNotFoundError when no invite matches the token", async () => {
      vi.mocked(onboardingRepository.getInviteWithOrgName).mockResolvedValue(
        undefined,
      );

      const { previewInvite, InviteNotFoundError } =
        await import("./onboarding.service.js");

      await expect(previewInvite(TOKEN)).rejects.toThrow(InviteNotFoundError);
    });

    it("raises InviteAlreadyUsedError when usedAt is already set", async () => {
      vi.mocked(onboardingRepository.getInviteWithOrgName).mockResolvedValue({
        invite: { usedAt: new Date(), expiresAt: new Date(Date.now() + 1_000) },
        organizationName: "Test Hospital",
      } as never);

      const { previewInvite, InviteAlreadyUsedError } =
        await import("./onboarding.service.js");

      await expect(previewInvite(TOKEN)).rejects.toThrow(
        InviteAlreadyUsedError,
      );
    });

    it("raises InviteExpiredError when the deadline has passed", async () => {
      vi.mocked(onboardingRepository.getInviteWithOrgName).mockResolvedValue({
        invite: { usedAt: null, expiresAt: new Date(Date.now() - 1_000) },
        organizationName: "Test Hospital",
      } as never);

      const { previewInvite, InviteExpiredError } =
        await import("./onboarding.service.js");

      await expect(previewInvite(TOKEN)).rejects.toThrow(InviteExpiredError);
    });

    it("returns the org name and role for a live, unused invite", async () => {
      vi.mocked(onboardingRepository.getInviteWithOrgName).mockResolvedValue({
        invite: {
          role: "desk_head",
          usedAt: null,
          expiresAt: new Date(Date.now() + 1_000),
        },
        organizationName: "Test Hospital",
      } as never);

      const { previewInvite } = await import("./onboarding.service.js");
      const result = await previewInvite(TOKEN);

      expect(result).toEqual({
        organizationName: "Test Hospital",
        role: "desk_head",
      });
    });
  });

  describe("acceptInvite", () => {
    it("raises the matching error for each non-ok redeem reason", async () => {
      const {
        acceptInvite,
        InviteNotFoundError,
        InviteExpiredError,
        InviteAlreadyUsedError,
        AlreadyOnboardedError,
      } = await import("./onboarding.service.js");

      const cases: [string, unknown][] = [
        ["not_found", InviteNotFoundError],
        ["expired", InviteExpiredError],
        ["used", InviteAlreadyUsedError],
        ["already_member", AlreadyOnboardedError],
      ];

      for (const [reason, ErrorClass] of cases) {
        vi.mocked(onboardingRepository.redeemInvite).mockResolvedValue({
          ok: false,
          reason,
        } as never);
        await expect(acceptInvite(TOKEN, USER_ID)).rejects.toThrow(
          ErrorClass as new (...args: never[]) => Error,
        );
      }
    });

    it("returns the new membership on success", async () => {
      vi.mocked(onboardingRepository.redeemInvite).mockResolvedValue({
        ok: true,
        member: { id: MEMBER_ID, role: "doctor" },
      } as never);

      const { acceptInvite } = await import("./onboarding.service.js");
      const result = await acceptInvite(TOKEN, USER_ID);

      expect(result).toEqual({ id: MEMBER_ID, role: "doctor" });
    });
  });
});
