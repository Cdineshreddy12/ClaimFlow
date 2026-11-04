import * as organizationsRepository from "./organizations.repository.js";
import type { UpdateProfileBody } from "./organizations.schema.js";

export class OrganizationNotFoundError extends Error {}

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

export async function getOrganization(organizationId: string) {
  const organization = await organizationsRepository.getById(organizationId);
  if (!organization) throw new OrganizationNotFoundError(organizationId);
  return organization;
}

/**
 * Saves one wizard step, then marks onboarding complete once every
 * required field across all three steps is filled — so finishing the
 * last step completes it, but so does coming back later to fill a gap.
 */
export async function updateProfile(
  organizationId: string,
  body: UpdateProfileBody,
) {
  const existing = await organizationsRepository.getById(organizationId);
  if (!existing) throw new OrganizationNotFoundError(organizationId);

  const patch = blankToNull(body.data);
  const merged = { ...existing, ...patch } as Record<string, unknown>;

  const isComplete = ALL_REQUIRED.every((field) => {
    const value = merged[field];
    return value !== null && value !== undefined && value !== "";
  });

  if (isComplete && !existing.onboardingCompletedAt) {
    patch.onboardingCompletedAt = new Date();
  }

  const updated = await organizationsRepository.updateProfile(
    organizationId,
    patch,
  );
  if (!updated) throw new OrganizationNotFoundError(organizationId);
  return updated;
}
