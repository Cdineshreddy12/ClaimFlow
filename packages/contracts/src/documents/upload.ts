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
