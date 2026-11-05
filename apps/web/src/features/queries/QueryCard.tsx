import { Envelope } from "reicon-react";
import { formatCountdown } from "./countdown";
import type { InboxQuery } from "./types";

/**
 * One row in the query list.
 *
 * Laid out like a row in the b2b-crm's email inbox: an envelope, a
 * two-line stack, and the time-sensitive thing pinned to the right of
 * each line. The claim reference takes the subject slot because that is
 * what a desk executive searches by; the insurer and procedure sit
 * underneath where the CRM puts the sender.
 */
export function QueryCard({
  query,
  selected,
  now,
  onSelect,
}: {
  query: InboxQuery;
  selected: boolean;
  now: number;
  onSelect: () => void;
}) {
  const countdown = formatCountdown(query.deadline, now);

  return (
    <button
      type="button"
      className={`flex w-full cursor-pointer items-start gap-2.5 border-b border-l-[3px] border-b-line-divider bg-transparent py-[11px] pl-[11px] pr-3.5 text-left ${
        selected
          ? "border-l-accent bg-accent-soft"
          : "border-l-transparent hover:bg-hover"
      }`}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
    >
      <Envelope
        size={17}
        className={`mt-px shrink-0 ${selected ? "text-accent" : "text-ink-faint"}`}
        aria-hidden
        focusable="false"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex min-w-0 items-baseline justify-between gap-2">
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-base font-semibold text-ink font-mono tabular-nums">
            {query.claimReference}
          </span>
          {countdown ? (
            // Dashed while the deadline is unconfirmed, the same way an
            // unconfirmed pre-auth field reads. The countdown still
            // shows: a desk that doesn't know a deadline exists is
            // worse off than one holding an unvouched date.
            <span
              title={
                query.deadlineConfirmedAt
                  ? undefined
                  : "Read from the TPA's email — not confirmed yet"
              }
              className={`shrink-0 text-xs tabular-nums${countdown.isOverdue ? " font-semibold text-critical" : " text-ink-faint"}${
                query.deadlineConfirmedAt
                  ? ""
                  : " border-b border-dashed border-line-strong"
              }`}
            >
              {countdown.text}
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 items-baseline justify-between gap-2">
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm text-ink-soft">
            {query.claimPatientName} · {query.insurerName}
          </span>
          {countdown?.isOverdue ? (
            <span className="shrink-0 rounded-xs bg-critical-bg px-1.5 py-[3px] text-2xs font-semibold leading-none text-critical">
              Overdue
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
