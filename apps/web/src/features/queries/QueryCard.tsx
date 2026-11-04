import { formatCountdown } from "./countdown";
import type { InboxQuery } from "./types";

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
      className={`query-card${selected ? " selected" : ""}`}
      onClick={onSelect}
    >
      <div className="query-card-top">
        <span>{query.insurerName}</span>
        {countdown ? (
          <span
            className={`chip ${countdown.isOverdue ? "chip--critical" : "chip--approved"}`}
            style={{ padding: "1px 7px" }}
          >
            {countdown.isOverdue
              ? `Overdue ${countdown.text.slice(1)}`
              : `Due in ${countdown.text.slice(1)}`}
          </span>
        ) : null}
      </div>
      <div className="query-card-claim mono">{query.claimId.slice(0, 8)}</div>
      <div className="query-card-ins">
        {query.claimPatientName} · {query.procedureName}
      </div>
    </button>
  );
}
