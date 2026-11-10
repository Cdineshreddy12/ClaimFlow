/**
 * What may be uploaded, and how much of it.
 *
 * The browser PUTs straight to S3 with a pre-signed URL and the API
 * never sees the bytes (docs/adr/0003), which is what makes these
 * limits worth stating carefully: by the time a file exists, nothing
 * server-side has had a chance to refuse it. The signature itself has
 * to carry the constraint.
 *
 * Shared because both ends enforce it — the browser so a 90MB video
 * fails in front of the person who chose it rather than after the
 * upload, and the API because a limit only the client applies is not a
 * limit.
 */

/**
 * 25MB. A multi-page discharge summary scanned at 300dpi runs to
 * eight or ten; a phone photo of a prescription is three. Nothing a
 * cashless claim legitimately carries approaches this, and the bucket
 * is billed by the gigabyte-month to whoever pays for the hospital.
 */
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Scans and photographs, which is the whole of what a claim file is.
 *
 * Deliberately no `application/octet-stream`. That is what a browser
 * reports when it cannot tell, and accepting it means accepting
 * everything — which was the previous behaviour, since the type was
 * only ever checked for being a non-empty string.
 */
export const ALLOWED_UPLOAD_TYPES: readonly string[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
];

export function isAllowedUploadType(contentType: string): boolean {
  return ALLOWED_UPLOAD_TYPES.includes(contentType.toLowerCase());
}

/**
 * 2MB, and PNG or JPEG only.
 *
 * A letterhead logo prints at 130×46pt — about 540×190 pixels at print
 * resolution — so anything approaching this is an asset nobody trimmed
 * rather than a logo that needs the room. The types are narrower than a
 * document's because pdf-lib can only embed what it can decode, and
 * that is these two.
 */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const ALLOWED_LOGO_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
];

/**
 * Why this logo cannot be uploaded, or null if it can.
 *
 * Here for the same reason `uploadRejection` is: the limit was stated
 * only in the API's schema, so the browser could not check it and the
 * page had nothing to say when the server refused beyond "try again".
 * A limit only one end knows is a limit the other end cannot explain.
 */
export function logoRejection(file: {
  type: string;
  size: number;
}): string | null {
  if (!ALLOWED_LOGO_TYPES.includes(file.type.toLowerCase())) {
    return file.type
      ? `${file.type} can't go on a letterhead — use a PNG or a JPEG.`
      : `That file's type couldn't be read — use a PNG or a JPEG.`;
  }
  if (file.size > LOGO_MAX_BYTES) {
    return `That logo is ${formatUploadLimit(file.size)}, over the ${formatUploadLimit(LOGO_MAX_BYTES)} limit.`;
  }
  if (file.size <= 0) return "That file is empty.";
  return null;
}

/** "25MB", for a message a person reads rather than a log line. */
export function formatUploadLimit(bytes: number = UPLOAD_MAX_BYTES): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

/**
 * Why this file cannot be uploaded, or null if it can.
 *
 * Returns the sentence shown to whoever picked the file, so the
 * browser and the API refuse in the same words.
 */
export function uploadRejection(file: {
  type: string;
  size: number;
}): string | null {
  if (!isAllowedUploadType(file.type)) {
    return file.type
      ? `${file.type} isn't a document type this accepts — attach a PDF or a scan.`
      : `That file's type couldn't be read — attach a PDF or a scan.`;
  }
  if (file.size > UPLOAD_MAX_BYTES) {
    return `That file is ${formatUploadLimit(file.size)}, over the ${formatUploadLimit()} limit.`;
  }
  if (file.size <= 0) return "That file is empty.";
  return null;
}
