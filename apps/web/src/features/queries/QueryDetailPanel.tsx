import { Link } from "react-router-dom";
import { useClaimGaps } from "../claims/api";
import { isRequestedItemAttached } from "./attachment";
import { formatCountdown } from "./countdown";
import { useMarkReplied } from "./api";
import type { InboxQuery } from "./types";

export function QueryDetailPanel({
  query,
  now,
}: {
  query: InboxQuery;
  now: number;
}) {
  const { data: gaps } = useClaimGaps(query.claimId);
  const markReplied = useMarkReplied();
  const countdown = formatCountdown(query.deadline, now);
  const satisfied = gaps?.satisfied ?? [];
  const allAttached = query.requestedItems.every((item) =>
    isRequestedItemAttached(item, satisfied),
  );

  return (
    <div className="card card-pad">
      <div className="detail-head">
        <div>
          <div className="claim-id mono">
            {query.claimId.slice(0, 8)} · {query.claimPatientName}
          </div>
          <div className="claim-meta" style={{ marginTop: 4 }}>
            <span>
              {query.procedureName} · {query.insurerName}
            </span>
          </div>
        </div>
        {countdown ? (
          <div className="countdown">
            <div
              className={`countdown-val mono ${countdown.isOverdue ? "is-critical" : "is-ok"}`}
            >
              {countdown.text}
            </div>
            <div className="countdown-label">{countdown.label}</div>
            {query.deadlineInferred ? (
              // Calculated from "within 48 hours", not read verbatim —
              // worth saying, because the desk may want to confirm it.
              <div
                className="countdown-label"
                style={{ textTransform: "none" }}
              >
                calculated from the email
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {query.aiSummary ? (
        <div className="ai-block">
          <div className="ai-block-label">
            {query.summarisedBy === "claude"
              ? "Summary · read from the email below"
              : "Summary · written by the desk"}
          </div>
          <p>{query.aiSummary}</p>
        </div>
      ) : null}

      {query.requestedItems.length > 0 ? (
        <>
          <div className="label-eyebrow" style={{ marginBottom: 8 }}>
            What they're asking for
          </div>
          <div className="req-list">
            {query.requestedItems.map((item) => {
              const attached = isRequestedItemAttached(item, satisfied);
              return (
                <div key={item} className="req-item">
                  <div className="req-item-name">{item}</div>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span
                      className={`chip ${attached ? "chip--approved" : "chip--critical"}`}
                    >
                      {attached ? "Looks attached" : "Not yet attached"}
                    </span>
                    {!attached ? (
                      <Link
                        to={`/claims/${query.claimId}`}
                        className="btn btn--ghost btn--sm"
                      >
                        Go attach it
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {query.tpaRawEmail ? (
        <details className="email-raw" open>
          <summary>Original email</summary>
          <div className="email-body">{query.tpaRawEmail}</div>
        </details>
      ) : null}

      {query.replySentAt ? (
        <div className="sent-confirm">
          <span>
            Marked as replied ·{" "}
            {new Date(query.replySentAt).toLocaleString("en-IN", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
        </div>
      ) : (
        <div className="reply-box">
          {markReplied.isError ? (
            <div className="inline-error">
              Couldn't mark this as replied — try again.
            </div>
          ) : null}
          <div className="reply-foot" style={{ marginTop: 0 }}>
            <span className="reply-note">
              {query.requestedItems.length === 0
                ? "No specific document requested on this query."
                : allAttached
                  ? "Everything requested looks attached on the claim."
                  : "Attach what's requested on the claim before marking this replied."}
            </span>
            <button
              type="button"
              className="btn btn--primary"
              disabled={markReplied.isPending}
              onClick={() => markReplied.mutate(query.id)}
            >
              {markReplied.isPending ? "Marking…" : "Mark as replied"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
