import * as auditService from "../audit/audit.service.js";
import * as hospitalRepository from "./hospital.repository.js";
import type { UpdateProfileBody } from "./hospital.schema.js";

export class HospitalNotFoundError extends Error {}

/** The fields each step owns — also what decides whether the profile counts as complete. */
const REQUIRED_BY_STEP = {
  identity: ["legalEntityName", "hospitalType", "ownershipType", "bedCount"],
  compliance: [
    "rohiniId",
    "registrationNumber",
    "registrationValidUntil",
    "pan",
  ],
  contact: [
    "addressLine1",
    "city",
    "state",
    "pincode",
    "phone",
    "email",
    "deskContactName",
    "deskContactPhone",
    "deskContactEmail",
  ],
} as const;

const ALL_REQUIRED = Object.values(REQUIRED_BY_STEP).flat();

/** "" from an untouched optional input means "not set", not an empty string we should persist. */
function blankToNull<T extends Record<string, unknown>>(data: T) {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, v === "" ? null : v]),
  );
}

export async function getHospital() {
  const hospital = await hospitalRepository.get();
  if (!hospital) throw new HospitalNotFoundError();
  return hospital;
}

/**
 * Saves one wizard step, then marks onboarding complete once every
 * required field across all three steps is filled — so finishing the
 * last step completes it, but so does coming back later to fill a gap.
 */
export async function updateProfile(
  auth: { userId: string },
  body: UpdateProfileBody,
) {
  const existing = await hospitalRepository.get();
  if (!existing) throw new HospitalNotFoundError();

  const patch = blankToNull(body.data);
  const merged = { ...existing, ...patch } as Record<string, unknown>;

  const isComplete = ALL_REQUIRED.every((field) => {
    const value = merged[field];
    return value !== null && value !== undefined && value !== "";
  });

  if (isComplete && !existing.onboardingCompletedAt) {
    patch.onboardingCompletedAt = new Date();
  }

  const updated = await hospitalRepository.updateProfile(patch);
  if (!updated) throw new HospitalNotFoundError();

  await auditService.record(auth, {
    action: "hospital.profile_updated",
    entityType: "hospital",
    entityId: existing.id,
    after: { step: body.step, fields: Object.keys(body.data) },
  });

  return updated;
}
