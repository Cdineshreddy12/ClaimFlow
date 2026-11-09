import {
  buildHospitalLogoKey,
  getDownloadUrl,
  getUploadUrl,
} from "../../integrations/storage/s3.js";
import * as auditService from "../audit/audit.service.js";
import * as hospitalRepository from "./hospital.repository.js";
import type {
  RequestLogoUploadUrlBody,
  UpdateProfileBody,
} from "./hospital.schema.js";

export class HospitalNotFoundError extends Error {}
/** A logo key the client is trying to adopt that this install never handed out. */
export class InvalidLogoKeyError extends Error {}

/** Every logo key this install hands out starts here — see requestLogoUploadUrl. */
const LOGO_KEY_PREFIX = "hospital/branding/";

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

/**
 * Attaches a short-lived preview URL for the settings page to show the
 * logo it already has — the bucket is private, so `logoFileKey` alone
 * can't be put in an <img src>. Never throws: a hospital must still load
 * if S3 is briefly unreachable, it just previews with no image that time.
 */
async function withLogoUrl<T extends { logoFileKey: string | null }>(
  hospital: T,
): Promise<T & { logoUrl: string | null }> {
  if (!hospital.logoFileKey) return { ...hospital, logoUrl: null };
  try {
    return { ...hospital, logoUrl: await getDownloadUrl(hospital.logoFileKey) };
  } catch {
    return { ...hospital, logoUrl: null };
  }
}

export async function getHospital() {
  const hospital = await hospitalRepository.get();
  if (!hospital) throw new HospitalNotFoundError();
  return withLogoUrl(hospital);
}

/** Step 1 of the logo upload flow — same shape as the per-claim document upload (docs/adr/0003). */
export async function requestLogoUploadUrl(body: RequestLogoUploadUrlBody) {
  const key = buildHospitalLogoKey(body.fileName);
  const uploadUrl = await getUploadUrl(key, body.contentType, body.sizeBytes);
  return { uploadUrl, key };
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

  // The key only ever reaches here by round-tripping through
  // requestLogoUploadUrl above, so a value outside that prefix means a
  // caller is trying to point the letterhead at some other object in the
  // bucket (a claim's attachment, say) rather than a logo it uploaded.
  if (
    body.step === "branding" &&
    body.data.logoFileKey &&
    !body.data.logoFileKey.startsWith(LOGO_KEY_PREFIX)
  ) {
    throw new InvalidLogoKeyError(body.data.logoFileKey);
  }

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

  return withLogoUrl(updated);
}
