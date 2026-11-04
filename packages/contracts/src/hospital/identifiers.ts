import { z } from "zod";

/**
 * Indian regulatory identifiers a hospital is asked for during cashless
 * empanelment. Shared here rather than duplicated per-app so the browser
 * rejects a typo'd GSTIN before the request is ever made, and the API
 * rejects the same value for the same reason if something bypasses the UI.
 */

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * The 15th GSTIN character is a mod-36 checksum over the first 14 — a
 * transposed digit fails this even though it passes the shape regex,
 * which is the whole point of checking it rather than just the pattern.
 */
export function gstinCheckDigit(first14: string): string {
  let factor = 2;
  let sum = 0;
  for (let i = first14.length - 1; i >= 0; i--) {
    const codePoint = GSTIN_CHARS.indexOf(first14[i]!);
    let digit = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    digit = Math.floor(digit / 36) + (digit % 36);
    sum += digit;
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36]!;
}

export function isValidGstin(value: string): boolean {
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(value)) {
    return false;
  }
  // State code 01-38, plus 97 (other territory) and 99 (centre jurisdiction).
  const stateCode = Number(value.slice(0, 2));
  const stateCodeValid =
    (stateCode >= 1 && stateCode <= 38) || stateCode === 97 || stateCode === 99;
  if (!stateCodeValid) return false;

  return value[14] === gstinCheckDigit(value.slice(0, 14));
}

/** 5 letters, 4 digits, 1 letter. The 4th letter encodes holder type — 'P' individual, 'C' company, 'T' trust, and so on. */
export const Pan = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must look like ABCDE1234F");

export const Gstin = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isValidGstin, "That GSTIN isn't valid — check for a typo");

/**
 * 13-digit code from the Insurance Information Bureau's ROHINI registry.
 * IRDAI requires it for cashless settlement, so a hospital without one
 * can't actually run a cashless desk — see docs/adr/0008.
 */
export const RohiniId = z
  .string()
  .trim()
  .regex(/^[0-9]{13}$/, "ROHINI ID is exactly 13 digits");

/** First digit 1-9 — no Indian PIN code starts with 0. */
export const Pincode = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, "PIN code is 6 digits");

/** 10 digits starting 6-9, optionally with +91 / 0 prefix, which is stripped. */
export const IndianPhone = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, "").replace(/^(\+91|0)/, ""))
  .pipe(z.string().regex(/^[6-9][0-9]{9}$/, "Enter a 10-digit mobile number"));

export const INDIAN_STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

export const IndianState = z.enum(INDIAN_STATES);
export type IndianState = z.infer<typeof IndianState>;

/** Matches the categories TPA empanelment forms use, so a desk head picks the same word they'd write on the form. */
export const HospitalType = z.enum([
  "day_care",
  "single_specialty",
  "multi_specialty",
  "super_specialty",
  "medical_college",
]);
export type HospitalType = z.infer<typeof HospitalType>;

export const OwnershipType = z.enum([
  "private",
  "trust",
  "charitable",
  "government",
  "missionary",
]);
export type OwnershipType = z.infer<typeof OwnershipType>;

/** NABH's own ladder — entry-level and progressive are real certificates, not "in progress" states. */
export const NabhStatus = z.enum([
  "none",
  "entry_level",
  "progressive",
  "accredited",
]);
export type NabhStatus = z.infer<typeof NabhStatus>;

export const HOSPITAL_TYPE_LABEL: Record<HospitalType, string> = {
  day_care: "Day care centre",
  single_specialty: "Single specialty",
  multi_specialty: "Multi specialty",
  super_specialty: "Super specialty",
  medical_college: "Medical college",
};

export const OWNERSHIP_TYPE_LABEL: Record<OwnershipType, string> = {
  private: "Private",
  trust: "Trust",
  charitable: "Charitable",
  government: "Government",
  missionary: "Missionary",
};

export const NABH_STATUS_LABEL: Record<NabhStatus, string> = {
  none: "Not accredited",
  entry_level: "Entry level",
  progressive: "Progressive",
  accredited: "Full accreditation",
};
