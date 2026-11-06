/**
 * When the TPA actually wrote, read off the pasted email.
 *
 * "Reply within 48 hours" is counted from the insurer's clock, not
 * ours. Anchoring it to the moment someone got round to pasting the
 * mail hands the desk hours it does not have — four of them on an
 * email opened the same afternoon, a whole day on one found the next
 * morning. On a product whose entire job is beating a TAT, that is the
 * wrong way to be wrong.
 *
 * Parsing is deliberately forgiving about format and strict about
 * sanity: a desk pastes whatever its mail client copied, and a
 * misparse that moves a deadline is worse than no parse at all.
 */

/** A `Date:` or Outlook `Sent:` header at the start of a line. */
const HEADER = /^[ \t]*(?:date|sent)[ \t]*:[ \t]*(.+)$/gim;

/** Clock skew between their mail server and ours. Beyond this, distrust the header. */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/**
 * Older than this and the header is more likely a misparse than a
 * genuinely stale email. A real backlog of a few weeks still anchors
 * correctly — and shows as already overdue, which is the truth.
 */
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * The send date of the topmost email in a pasted thread, or null.
 *
 * The first header wins because a forwarded chain runs newest-first:
 * the deadline belongs to the mail that just arrived, not to the one
 * it quotes underneath.
 */
export function emailSentAt(rawEmail: string, now: Date): Date | null {
  HEADER.lastIndex = 0;
  for (const match of rawEmail.matchAll(HEADER)) {
    const parsed = new Date(match[1]!.trim());
    if (Number.isNaN(parsed.getTime())) continue;

    const age = now.getTime() - parsed.getTime();
    if (age < -FUTURE_TOLERANCE_MS) continue;
    if (age > MAX_AGE_MS) continue;

    return parsed;
  }
  return null;
}
