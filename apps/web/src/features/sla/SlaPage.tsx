import { CLAIM_STATUS_LABELS } from "./labels";
import { AppShell } from "../../app/AppShell";
import { Loader } from "../../components/ui/loader";
import { STATUS_LABEL } from "../claims/types";
import { Link } from "react-router-dom";
import { useSlaWatch, useTurnaround } from "./api";
import { SlaClock } from "./SlaClock";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatHours(hours: number) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
}

/**
 * Two questions on one page: who is waiting right now, and which
 * insurers habitually make people wait.
 *
 * The second is the one nothing else in the product answers. It is the
 * hospital's own timestamps, per insurer, against the regulatory
 * window — a number to take into the next negotiation rather than an
 * impression (docs/adr/0014).
 */
export function SlaPage() {
  const { data: watch, isLoading } = useSlaWatch();
  const { data: turnaround } = useTurnaround();

  return (
    <AppShell
      title="Turnaround"
      subtitle="Live clocks, and how each insurer actually performs"
    >
      {isLoading ? <Loader label="Reading the clocks…" /> : null}

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Against the clock</CardTitle>
          {watch ? (
            <Badge variant={watch.breached > 0 ? "critical" : "approved"}>
              {watch.breached > 0
                ? `${watch.breached} overdue · ${watch.dueSoon} due soon`
                : "All within time"}
            </Badge>
          ) : null}
        </CardHeader>

        {watch && watch.items.length === 0 ? (
          <p className="px-1 py-2.5 text-base text-ink-faint">
            Nothing is on a clock right now.
          </p>
        ) : (
          <div className="flex flex-col gap-px overflow-hidden rounded-sm border border-line bg-line">
            {(watch?.items ?? []).map((item) => (
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
                  <span className="text-sm text-ink-soft">
                    {item.insurerName}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-sm text-ink-soft">
                    {STATUS_LABEL[item.status]}
                  </span>
                  {item.owedBy ? (
                    <span className="text-sm text-ink-soft">
                      waiting on the {item.owedBy}
                    </span>
                  ) : null}
                  <SlaClock status={item.status} deadline={item.slaDeadline} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Insurer turnaround · last 30 days</CardTitle>
        </CardHeader>

        {!turnaround || turnaround.rows.length === 0 ? (
          <p className="px-1 py-2.5 text-base text-ink-faint">
            No answered requests in the window yet. This fills in as claims
            move.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Insurer</TableHead>
                <TableHead>Decision</TableHead>
                <TableHead className="text-right">Average</TableHead>
                <TableHead className="text-right">Worst</TableHead>
                <TableHead className="text-right">Target</TableHead>
                <TableHead className="text-right">Past target</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {turnaround.rows.map((row) => (
                <TableRow key={`${row.insurerName}-${row.fromStatus}`}>
                  <TableCell>{row.insurerName}</TableCell>
                  <TableCell>
                    {CLAIM_STATUS_LABELS[row.fromStatus] ??
                      STATUS_LABEL[row.fromStatus]}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatHours(row.avgHours)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatHours(row.worstHours)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.targetHours === null ? "—" : `${row.targetHours}h`}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono tabular-nums${row.breachRate >= 0.5 ? " font-semibold text-critical" : ""}`}
                  >
                    {row.breaches} of {row.decisions}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <p className="mt-[11px] text-xs leading-normal text-ink-faint">
          Measured between your own status timestamps: the clock starts when the
          desk sends, and stops when the next status lands. Requests still
          waiting are excluded rather than counted as fast.
        </p>
      </Card>
    </AppShell>
  );
}
