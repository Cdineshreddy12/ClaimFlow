import { useState } from "react";
import { Link } from "react-router-dom";
import { useClaimGaps } from "../claims/api";
import { isRequestedItemAttached } from "./attachment";
import { formatCountdown } from "./countdown";
import { fromLocalInput, toLocalInput } from "./deadline";
import { useConfirmDeadline, useMarkReplied } from "./api";
import type { InboxQuery } from "./types";
import { Button } from "../../components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * The reply deadline, and the confirm step on it.
 *
 * The summariser writes this one straight into the column the inbox
 * sorts by — unlike a document's slot or a pre-auth value, which wait
 * in a suggestion column for a click. So the click lives here, next to
 * the email it was read out of: the countdown shows either way, because
 * a desk that doesn't know a deadline exists is worse off than one
 * holding an unvouched date, but until someone confirms it, it renders
 * dashed and says where it came from (docs/adr/0005).
 */
function DeadlineRow({ query, now }: { query: InboxQuery; now: number }) {
  const confirmDeadline = useConfirmDeadline();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const countdown = formatCountdown(query.deadline, now);
  const confirmed = Boolean(query.deadlineConfirmedAt);

  function startEditing() {
    setDraft(toLocalInput(query.deadline));
    setEditing(true);
  }

  function save() {
    confirmDeadline.mutate(
      { id: query.id, deadline: fromLocalInput(draft) },
      { onSuccess: () => setEditing(false) },
    );
  }

  if (editing) {
    return (
      <>
        <dt>Reply by</dt>
        <dd>
          <div className="flex flex-col items-start gap-1.5">
            <input
              type="datetime-local"
              aria-label="Reply deadline"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
              className="rounded-sm border border-line-strong bg-surface-raised px-2 py-1.5 text-base text-ink tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            />
            {/* Clearing the field is how a wrong inferred deadline gets
                taken off the claim, so an empty one saves rather than
                blocking. */}
            <span className="text-sm text-ink-faint">
              {draft
                ? "Saving confirms this date."
                : "Leave it empty if the email sets no deadline."}
            </span>
            <div className="flex gap-1.5">
              <Button
                type="button"
                size="sm"
                disabled={confirmDeadline.isPending}
                onClick={save}
              >
                {confirmDeadline.isPending ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </dd>
      </>
    );
  }

  if (!countdown) {
    // The summariser read the email and found no date. Saying so is the
    // point — a blank row reads as "nobody has looked".
    return query.summarisedBy === "claude" ? (
      <>
        <dt>Reply by</dt>
        <dd>
          <span className="text-ink-faint">No deadline in the email</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-2 align-middle"
            onClick={startEditing}
          >
            Set one
          </Button>
        </dd>
      </>
    ) : null;
  }

  return (
    <>
      <dt>Reply by</dt>
      <dd>
        <span
          className={`font-semibold tabular-nums${countdown.isOverdue ? " text-critical" : ""}${
            confirmed ? "" : " border-b border-dashed border-line-strong"
          }`}
        >
          {countdown.text} · {countdown.label.toLowerCase()}
        </span>
        {confirmed ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-2 align-middle"
            onClick={startEditing}
          >
            Change
          </Button>
        ) : (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink-faint">
              {query.deadlineInferred
                ? // Calculated from "within 48 hours", not read verbatim.
                  "Calculated from the email below — check it."
                : "Read from the email below — check it."}
            </span>
            <Button
              type="button"
              size="sm"
              disabled={confirmDeadline.isPending}
              onClick={() => confirmDeadline.mutate({ id: query.id })}
            >
              {confirmDeadline.isPending ? "Confirming…" : "Confirm"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={startEditing}
            >
              Change
            </Button>
          </div>
        )}
        {confirmDeadline.isError ? (
          <span className="mt-1 block text-sm font-medium text-critical">
            Couldn&apos;t save that deadline — try again.
          </span>
        ) : null}
      </dd>
    </>
  );
}

export function QueryDetailPanel({
  query,
  now,
}: {
  query: InboxQuery;
  now: number;
}) {
  const { data: gaps } = useClaimGaps(query.claimId);
  const markReplied = useMarkReplied();
  const satisfied = gaps?.satisfied ?? [];
  const allAttached = query.requestedItems.every((item) =>
    isRequestedItemAttached(item, satisfied),
  );

  return (
    <div className="block">
      {/*
        The b2b-crm's message header: the subject on its own line, then
        a label/value block. "Reply by" takes the Date slot, because on
        a TPA query the deadline is the thing the desk reads first.
      */}
      <div className="mb-4 border-b border-line pb-3.5">
        <h2 className="m-0 mb-3 text-lg font-semibold tracking-[-0.01em] text-ink">
          {query.requestedItems.length > 0
            ? query.requestedItems[0]
            : "Query on this claim"}
        </h2>
        <dl className="m-0 grid grid-cols-[68px_1fr] gap-x-3 gap-y-1.5 text-base [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:text-ink [&_dt]:text-ink-faint">
          <dt>From</dt>
          <dd>{query.insurerName}</dd>
          <dt>Claim</dt>
          <dd>
            <Link
              to={`/claims/${query.claimId}`}
              className="font-semibold text-accent-ink no-underline hover:underline font-mono tabular-nums"
            >
              {query.claimReference}
            </Link>
            <span className="mt-0.5 block text-sm text-ink-faint">
              {query.claimPatientName} · {query.procedureName}
            </span>
          </dd>
          <DeadlineRow query={query} now={now} />
        </dl>
      </div>

      {query.aiSummary ? (
        <div className="mb-3.5 rounded-md border border-line bg-accent-soft px-4 py-3.5 [&_p]:m-0 [&_p]:text-md">
          <div className="mb-2 text-2xs font-bold uppercase tracking-[0.05em] text-accent-ink">
            {query.summarisedBy === "claude"
              ? "Summary · read from the email below"
              : "Summary · written by the desk"}
          </div>
          <p>{query.aiSummary}</p>
        </div>
      ) : null}

      {query.requestedItems.length > 0 ? (
        <>
          <div
            className="text-2xs font-semibold uppercase tracking-[0.07em] text-ink-faint"
            style={{ marginBottom: 8 }}
          >
            What they're asking for
          </div>
          <div className="mb-4 flex flex-col gap-2">
            {query.requestedItems.map((item) => {
              const attached = isRequestedItemAttached(item, satisfied);
              return (
                <div
                  key={item}
                  className="flex items-center justify-between gap-2.5 rounded-md border border-line px-3 py-2.5"
                >
                  <div className="text-base font-medium">{item}</div>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <Badge variant={attached ? "approved" : "critical"}>
                      {attached ? "Looks attached" : "Not yet attached"}
                    </Badge>
                    {!attached ? (
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/claims/${query.claimId}`}>
                          Go attach it
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {query.tpaRawEmail ? (
        <details
          className="mb-4 rounded-md border border-line [&>summary]:cursor-pointer [&>summary]:px-[13px] [&>summary]:py-2.5 [&>summary]:text-sm [&>summary]:font-semibold [&>summary]:uppercase [&>summary]:tracking-[0.04em] [&>summary]:text-ink-faint [&[open]>summary]:border-b [&[open]>summary]:border-line"
          open
        >
          <summary>Original email</summary>
          <div className="whitespace-pre-wrap px-4 py-[13px] text-base leading-relaxed text-ink-soft">
            {query.tpaRawEmail}
          </div>
        </details>
      ) : null}

      {query.replySentAt ? (
        <div className="flex items-center gap-[9px] rounded-md border border-approved bg-approved-bg px-3.5 py-3 text-base text-ink">
          <span>
            Marked as replied ·{" "}
            {new Date(query.replySentAt).toLocaleString("en-IN", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
        </div>
      ) : (
        <div className="rounded-md border border-line px-3.5 py-3">
          {markReplied.isError ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
              Couldn't mark this as replied — try again.
            </div>
          ) : null}
          <div
            className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center"
            style={{ marginTop: 0 }}
          >
            <span className="text-sm text-ink-faint">
              {query.requestedItems.length === 0
                ? "No specific document requested on this query."
                : allAttached
                  ? "Everything requested looks attached on the claim."
                  : "Attach what's requested on the claim before marking this replied."}
            </span>
            <Button
              type="button"
              disabled={markReplied.isPending}
              onClick={() => markReplied.mutate(query.id)}
            >
              {markReplied.isPending ? "Marking…" : "Mark as replied"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
