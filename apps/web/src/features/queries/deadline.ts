/**
 * A reply deadline, between the ISO instant the API speaks and the
 * wall-clock string `<input type="datetime-local">` speaks.
 *
 * Both directions go through the browser's timezone, deliberately: the
 * input carries no offset, and a desk in Chennai typing 18:00 means
 * 18:00 IST — which is what the TPA's email meant when it said so too.
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO instant → the local `YYYY-MM-DDTHH:mm` the input expects. "" for no deadline. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * The input's value → an ISO instant, or null.
 *
 * Null is a real answer here, not a failure: an empty field is the desk
 * saying the email set no deadline, which is how a wrong inferred one
 * gets cleared.
 */
export function fromLocalInput(value: string): string | null {
  if (!value.trim()) return null;
  // A date-time with no offset parses as local time, which is what the
  // input means by it.
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
