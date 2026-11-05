import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { STATUS_LABEL } from "../claims/types";
import { useSlaWatch } from "./api";
import { SlaClock } from "./SlaClock";
import { Badge } from "@/components/ui/badge";

/**
 * Who is waiting, worst first.
 *
 * The dashboard's existing counts say how much work is open; this says
 * what is late, which is a different and more urgent question. Only the
 * top few — the rest live on the SLA page, and a dashboard card that
 * scrolls is a card nobody reads to the end of.
 */
export function SlaWatchCard({ limit = 5 }: { limit?: number }) {
  const { data } = useSlaWatch();
  if (!data) return null;

  const shown = data.items.slice(0, limit);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Against the clock</CardTitle>
        <Badge variant={data.breached > 0 ? "critical" : "approved"}>
          {data.breached > 0 ? `${data.breached} overdue` : "All within time"}
        </Badge>
      </CardHeader>

      {shown.length === 0 ? (
        <p className="px-1 py-2.5 text-base text-ink-faint">
          Nothing is on a clock right now.
        </p>
      ) : (
        <div className="flex flex-col gap-px overflow-hidden rounded-sm border border-line bg-line">
          {shown.map((item) => (
            <Link
              key={item.claimId}
              to={`/claims/${item.claimId}`}
              className={`flex flex-wrap items-center justify-between gap-3 border-l-[3px] border-l-transparent bg-surface-raised px-[13px] py-2.5 text-inherit no-underline hover:bg-accent-soft${item.state === "breached" ? " !border-l-critical" : ""}`}
            >
              <div className="flex min-w-0 flex-wrap items-baseline gap-2.5">
                <span className="font-mono tabular-nums text-sm text-ink-faint">
                  {item.reference}
                </span>
                <span className="text-base font-semibold text-ink">
                  {item.patientName}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-sm text-ink-soft">
                  {STATUS_LABEL[item.status]}
                </span>
                <SlaClock status={item.status} deadline={item.slaDeadline} />
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Said once, because the desk is held to the whole number and
          only owns part of it. */}
      {data.breached > 0 ? (
        <p className="mt-[11px] text-xs leading-normal text-ink-faint">
          {data.breachedOnInsurer} of {data.breached} are waiting on an insurer,
          not on the desk.
        </p>
      ) : null}

      {data.items.length > shown.length ? (
        <Link to="/sla" className="mt-2.5 inline-block text-sm text-accent">
          See all {data.items.length} →
        </Link>
      ) : null}
    </Card>
  );
}
