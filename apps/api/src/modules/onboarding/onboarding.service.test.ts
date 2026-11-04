import { beforeEach, describe, expect, it, vi } from "vitest";
import * as onboardingRepository from "./onboarding.repository.js";
import * as membersRepository from "../members/members.repository.js";

vi.mock("./onboarding.repository.js");
vi.mock("../members/members.repository.js");

const USER_ID = "22222222-2222-2222-2222-222222222222";
const MEMBER_ID = "33333333-3333-3333-3333-333333333333";
const TOKEN = "some-invite-token";

function auth(role: "org_admin" | "desk_head" = "org_admin") {
  return { userId: USER_ID, role };
}

describe("onboarding.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("setUpHospital", () => {
    it("raises AlreadyOnboardedError when the user already has a membership", async () => {
      vi.mocked(onboardingRepository.getMembershipForUser).mockResolvedValue({
        id: MEMBER_ID,
      } as never);

      const { setUpHospital, AlreadyOnboardedError } =
        await import("./onboarding.service.js");

      await expect(setUpHospital(USER_ID, "New Hospital")).rejects.toThrow(
        AlreadyOnboardedError,
      );
      expect(onboardingRepository.setUpHospital).not.toHaveBeenCalled();
    });

    it("refuses once somebody already has an account here", async () => {
      // One install, one hospital — whoever arrives second joins by
      // invite. Keyed off members, not the hospital row, so a seeded
      // database doesn't lock out its first real user.
      vi.mocked(onboardingRepository.getMembershipForUser).mockResolvedValue(
        undefined,
      );
      vi.mocked(onboardingRepository.hasAnyMember).mockResolvedValue(true);

      const { setUpHospital, HospitalAlreadySetUpError } =
        await import("./onboarding.service.js");

      await expect(setUpHospital(USER_ID, "Second Hospital")).rejects.toThrow(
        HospitalAlreadySetUpError,
      );
      expect(onboardingRepository.setUpHospital).not.toHaveBeenCalled();
    });

    it("claims the install when nobody has yet", async () => {
      vi.mocked(onboardingRepository.getMembershipForUser).mockResolvedValue(
        undefined,
      );
      vi.mocked(onboardingRepository.hasAnyMember).mockResolvedValue(false);
      vi.mocked(onboardingRepository.setUpHospital).mockResolvedValue({
        hospital: { id: "h1", name: "New Hospital" },
        member: { id: MEMBER_ID },
      } as never);

      const { setUpHospital } = await import("./onboarding.service.js");
      await setUpHospital(USER_ID, "New Hospital");

      expect(onboardingRepository.setUpHospital).toHaveBeenCalledWith(
        USER_ID,
        "New Hospital",
      );
    });
  });

  describe("createInvite", () => {
    it("resolves the caller's own member id and passes it as createdBy", async () => {
      vi.mocked(membersRepository.getMemberId).mockResolvedValue(MEMBER_ID);
      vi.mocked(onboardingRepository.createInvite).mockResolvedValue(
        {} as never,
      );

      const { createInvite } = await import("./onboarding.service.js");
      await createInvite(auth(), "desk_executive");

      expect(onboardingRepository.createInvite).toHaveBeenCalledWith(
        "desk_executive",
        MEMBER_ID,
      );
    });
  });

  describe("previewInvite", () => {
    it("raises InviteNotFoundError when no invite matches the token", async () => {
      vi.mocked(
        onboardingRepository.getInviteWithHospitalName,
      ).mockResolvedValue(undefined);

      const { previewInvite, InviteNotFoundError } =
        await import("./onboarding.service.js");

      await expect(previewInvite(TOKEN)).rejects.toThrow(InviteNotFoundError);
    });

    it("raises InviteAlreadyUsedError when usedAt is already set", async () => {
      vi.mocked(
        onboardingRepository.getInviteWithHospitalName,
      ).mockResolvedValue({
        invite: { usedAt: new Date(), expiresAt: new Date(Date.now() + 1_000) },
        hospitalName: "Test Hospital",
      } as never);

      const { previewInvite, InviteAlreadyUsedError } =
        await import("./onboarding.service.js");

      await expect(previewInvite(TOKEN)).rejects.toThrow(
        InviteAlreadyUsedError,
      );
    });

    it("raises InviteExpiredError when the deadline has passed", async () => {
      vi.mocked(
        onboardingRepository.getInviteWithHospitalName,
      ).mockResolvedValue({
        invite: { usedAt: null, expiresAt: new Date(Date.now() - 1_000) },
        hospitalName: "Test Hospital",
      } as never);

      const { previewInvite, InviteExpiredError } =
        await import("./onboarding.service.js");

      await expect(previewInvite(TOKEN)).rejects.toThrow(InviteExpiredError);
    });

    it("returns the hospital name and role for a live, unused invite", async () => {
      vi.mocked(
        onboardingRepository.getInviteWithHospitalName,
      ).mockResolvedValue({
        invite: {
          role: "desk_head",
          usedAt: null,
          expiresAt: new Date(Date.now() + 1_000),
        },
        hospitalName: "Test Hospital",
      } as never);

      const { previewInvite } = await import("./onboarding.service.js");
      const result = await previewInvite(TOKEN);

      expect(result).toEqual({
        hospitalName: "Test Hospital",
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
