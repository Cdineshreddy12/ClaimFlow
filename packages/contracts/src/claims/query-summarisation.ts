import { z } from "zod";

/**
 * Whether the summariser ran on a query's email, and how it went.
 *
 * Added because a failed summarisation and a query nobody asked the
 * model about looked identical from the outside: both left
 * `ai_summary` null and `summarised_by` null. A desk staring at an
 * empty summary could not tell whether the model had read the email
 * and found nothing to say, or had never been called, or had fallen
 * over — and nothing in the product offered to try again.
 *
 * Shared rather than declared on each side: the API writes it and the
 * inbox branches on it, which is exactly the pair that drifts when a
 * value is spelled out twice.
 */
export const SummarisationStatus = z.enum(["ok", "failed", "not_attempted"]);
export type SummarisationStatus = z.infer<typeof SummarisationStatus>;

/**
 * Whether offering "try again" on this query would do anything.
 *
 * Only a failure is worth retrying, and only when the email it would
 * read is still there. A query the desk wrote itself, or one the model
 * read cleanly, has nothing to retry — and `not_attempted` means no
 * key is configured, which a button press will not change.
 */
export function canRetrySummarisation(input: {
  summarisationStatus: SummarisationStatus;
  tpaRawEmail: string | null;
}): boolean {
  return input.summarisationStatus === "failed" && Boolean(input.tpaRawEmail);
}
