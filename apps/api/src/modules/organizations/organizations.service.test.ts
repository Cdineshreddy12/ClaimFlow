import { beforeEach, describe, expect, it, vi } from "vitest";
import * as organizationsRepository from "./organizations.repository.js";

vi.mock("./organizations.repository.js");

const ORG_ID = "11111111-1111-1111-1111-111111111111";

/** An org with every required field filled except the ones the test blanks out. */
function completeOrg(overrides: Record<string, unknown> = {}) {
  return {
    id: ORG_ID,
    name: "Test Hospital",
    legalEntityName: "Test Hospital Pvt Ltd",
    hospitalType: "multi_specialty",
    ownershipType: "private",
    bedCount: 180,
    rohiniId: "1234567890123",
    registrationNumber: "REG-1",
    registrationValidUntil: "2027-01-01",
    pan: "ABCDE1234F",
    addressLine1: "1 Main Road",
    city: "Pune",
    state: "Maharashtra",
    pincode: "422001",
    phone: "9876543210",
    email: "desk@test.example",
    deskContactName: "Priya Nair",
    deskContactPhone: "9876543210",
    deskContactEmail: "priya@test.example",
    onboardingCompletedAt: null,
    ...overrides,
  };
}

describe("organizations.service.updateProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(organizationsRepository.updateProfile).mockImplementation(
      async (_id, patch) => ({ ...completeOrg(), ...patch }) as never,
    );
  });

  it("stamps onboardingCompletedAt once the final gap is filled", async () => {
    vi.mocked(organizationsRepository.getById).mockResolvedValue(
      completeOrg({ deskContactEmail: null }) as never,
    );

    const { updateProfile } = await import("./organizations.service.js");
    await updateProfile(ORG_ID, {
      step: "contact",
      data: { deskContactEmail: "priya@test.example" } as never,
    });

    const patch = vi.mocked(organizationsRepository.updateProfile).mock
      .calls[0]![1] as Record<string, unknown>;
    expect(patch.onboardingCompletedAt).toBeInstanceOf(Date);
  });

  it("leaves onboardingCompletedAt unset while a required field is still missing", async () => {
    vi.mocked(organizationsRepository.getById).mockResolvedValue(
      completeOrg({ rohiniId: null, deskContactEmail: null }) as never,
    );

    const { updateProfile } = await import("./organizations.service.js");
    await updateProfile(ORG_ID, {
      step: "contact",
      data: { deskContactEmail: "priya@test.example" } as never,
    });

    const patch = vi.mocked(organizationsRepository.updateProfile).mock
      .calls[0]![1] as Record<string, unknown>;
    expect(patch.onboardingCompletedAt).toBeUndefined();
  });

  it("does not re-stamp onboardingCompletedAt on a later edit", async () => {
    const alreadyDone = new Date("2026-01-01T00:00:00Z");
    vi.mocked(organizationsRepository.getById).mockResolvedValue(
      completeOrg({ onboardingCompletedAt: alreadyDone }) as never,
    );

    const { updateProfile } = await import("./organizations.service.js");
    await updateProfile(ORG_ID, {
      step: "identity",
      data: { bedCount: 200 } as never,
    });

    const patch = vi.mocked(organizationsRepository.updateProfile).mock
      .calls[0]![1] as Record<string, unknown>;
    expect(patch.onboardingCompletedAt).toBeUndefined();
  });

  it("persists an untouched optional field as null, not an empty string", async () => {
    vi.mocked(organizationsRepository.getById).mockResolvedValue(
      completeOrg() as never,
    );

    const { updateProfile } = await import("./organizations.service.js");
    await updateProfile(ORG_ID, {
      step: "compliance",
      data: { gstin: "", nabhValidUntil: "" } as never,
    });

    const patch = vi.mocked(organizationsRepository.updateProfile).mock
      .calls[0]![1] as Record<string, unknown>;
    expect(patch.gstin).toBeNull();
    expect(patch.nabhValidUntil).toBeNull();
  });

  it("raises OrganizationNotFoundError for an unknown org", async () => {
    vi.mocked(organizationsRepository.getById).mockResolvedValue(undefined);

    const { updateProfile, OrganizationNotFoundError } =
      await import("./organizations.service.js");

    await expect(
      updateProfile(ORG_ID, {
        step: "identity",
        data: { bedCount: 10 } as never,
      }),
    ).rejects.toThrow(OrganizationNotFoundError);
  });
});
