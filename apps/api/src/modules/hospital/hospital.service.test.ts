import { beforeEach, describe, expect, it, vi } from "vitest";
import * as hospitalRepository from "./hospital.repository.js";

vi.mock("./hospital.repository.js");

const HOSPITAL_ID = "11111111-1111-1111-1111-111111111111";
const AUTH = {
  userId: "22222222-2222-2222-2222-222222222222",
};

/** A hospital with every required field filled except the ones a test blanks out. */
function completeHospital(overrides: Record<string, unknown> = {}) {
  return {
    id: HOSPITAL_ID,
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

describe("hospital.service.updateProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hospitalRepository.updateProfile).mockImplementation(
      async (patch) => ({ ...completeHospital(), ...patch }) as never,
    );
  });

  it("stamps onboardingCompletedAt once the final gap is filled", async () => {
    vi.mocked(hospitalRepository.get).mockResolvedValue(
      completeHospital({ deskContactEmail: null }) as never,
    );

    const { updateProfile } = await import("./hospital.service.js");
    await updateProfile(AUTH, {
      step: "contact",
      data: { deskContactEmail: "priya@test.example" } as never,
    });

    const patch = vi.mocked(hospitalRepository.updateProfile).mock
      .calls[0]![0] as Record<string, unknown>;
    expect(patch.onboardingCompletedAt).toBeInstanceOf(Date);
  });

  it("leaves onboardingCompletedAt unset while a required field is still missing", async () => {
    vi.mocked(hospitalRepository.get).mockResolvedValue(
      completeHospital({ rohiniId: null, deskContactEmail: null }) as never,
    );

    const { updateProfile } = await import("./hospital.service.js");
    await updateProfile(AUTH, {
      step: "contact",
      data: { deskContactEmail: "priya@test.example" } as never,
    });

    const patch = vi.mocked(hospitalRepository.updateProfile).mock
      .calls[0]![0] as Record<string, unknown>;
    expect(patch.onboardingCompletedAt).toBeUndefined();
  });

  it("does not re-stamp onboardingCompletedAt on a later edit", async () => {
    const alreadyDone = new Date("2026-01-01T00:00:00Z");
    vi.mocked(hospitalRepository.get).mockResolvedValue(
      completeHospital({ onboardingCompletedAt: alreadyDone }) as never,
    );

    const { updateProfile } = await import("./hospital.service.js");
    await updateProfile(AUTH, {
      step: "identity",
      data: { bedCount: 200 } as never,
    });

    const patch = vi.mocked(hospitalRepository.updateProfile).mock
      .calls[0]![0] as Record<string, unknown>;
    expect(patch.onboardingCompletedAt).toBeUndefined();
  });

  it("persists an untouched optional field as null, not an empty string", async () => {
    vi.mocked(hospitalRepository.get).mockResolvedValue(
      completeHospital() as never,
    );

    const { updateProfile } = await import("./hospital.service.js");
    await updateProfile(AUTH, {
      step: "compliance",
      data: { gstin: "", nabhValidUntil: "" } as never,
    });

    const patch = vi.mocked(hospitalRepository.updateProfile).mock
      .calls[0]![0] as Record<string, unknown>;
    expect(patch.gstin).toBeNull();
    expect(patch.nabhValidUntil).toBeNull();
  });

  it("raises HospitalNotFoundError before the hospital is set up", async () => {
    vi.mocked(hospitalRepository.get).mockResolvedValue(undefined);

    const { updateProfile, HospitalNotFoundError } =
      await import("./hospital.service.js");

    await expect(
      updateProfile(AUTH, {
        step: "identity",
        data: { bedCount: 10 } as never,
      }),
    ).rejects.toThrow(HospitalNotFoundError);
  });
});
