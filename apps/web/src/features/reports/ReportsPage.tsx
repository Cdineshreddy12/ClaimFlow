import { useState } from "react";
import { DEDUCTION_REASON_LABEL } from "@claimflow/contracts";
import { AppShell } from "@/app/AppShell";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAmount } from "@/lib/format";
import { CLAIM_STATUS_LABELS } from "../sla/labels";
import { downloadPeriodReportPdf, usePeriodReport } from "./api";

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, mon! - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The one screen built for a person who never logs in: a desk head
 * picks a closed month, reads the same three numbers the dashboard and
 * Turnaround page already compute, and downloads a PDF to forward to
 * whoever signs the deal. See docs/adr/0018.
 */
export function ReportsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [downloading, setDownloading] = useState(false);
  const { data: report, isLoading, isError } = usePeriodReport(month);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadPeriodReportPdf(month);
    } finally {
      setDownloading(false);
    }
  }

  // The nav hides this link from a desk_executive, but the route itself
  // doesn't — and the API gates it (docs/adr/0018), so a direct link
  // still needs its own word rather than an empty page.
  if (isError) {
    return (
      <AppShell title="Reports" subtitle="Not available for your role">
        <p className="px-1 py-2.5 text-base text-ink-faint">
          Reports are visible to a desk head or admin. Ask one of them to pull
          this month's numbers.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Reports"
      subtitle="The month's numbers, forwardable to whoever signs the deal"
    >
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.05em] text-ink-faint">
            Month
          </span>
          <input
            type="month"
            value={month}
            max={currentMonth()}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-sm border border-line bg-surface-raised px-2.5 py-1.5 text-base text-ink"
          />
        </label>
        <Button
          type="button"
          onClick={handleDownload}
          disabled={downloading || !report}
        >
          {downloading ? "Preparing…" : "Download PDF"}
        </Button>
      </div>

      {isLoading ? <Loader label="Reading the month…" /> : null}

      {report ? (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:[grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
            <Kpi label="Claims Opened" value={String(report.claims.opened)} />
            <Kpi label="Claims Settled" value={String(report.claims.settled)} />
            <Kpi
              label="Settled Value"
              value={formatAmount(String(report.claims.settledValue))}
            />
            <Kpi
              label="Avg Turnaround"
              value={
                report.claims.avgTatDays != null
                  ? `${report.claims.avgTatDays.toFixed(1)}d`
                  : "—"
              }
            />
          </div>

          <Card className="mb-5">
            <CardHeader>
              <CardTitle>Deductions by reason · {monthLabel(month)}</CardTitle>
            </CardHeader>
            {report.deductions.byReason.length === 0 ? (
              <p className="px-1 py-2.5 text-base text-ink-faint">
                No deductions recorded this month.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Recovered</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.deductions.byReason.map((row) => (
                    <TableRow key={row.reason}>
                      <TableCell>
                        {DEDUCTION_REASON_LABEL[row.reason]}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.count}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatAmount(String(row.total))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatAmount(String(row.recovered))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="mt-2.5 px-1 text-sm text-ink-soft">
              {formatAmount(String(report.deductions.avoidableTotal))} of{" "}
              {formatAmount(String(report.deductions.total))} was avoidable —
              the 40% target this report tracks against.
            </p>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Insurer turnaround · {monthLabel(month)}</CardTitle>
            </CardHeader>
            {report.turnaround.rows.length === 0 ? (
              <p className="px-1 py-2.5 text-base text-ink-faint">
                No answered requests this month.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Insurer</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead className="text-right">Average</TableHead>
                    <TableHead className="text-right">Target</TableHead>
                    <TableHead className="text-right">Past target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.turnaround.rows.map((row) => (
                    <TableRow key={`${row.insurerName}-${row.fromStatus}`}>
                      <TableCell>{row.insurerName}</TableCell>
                      <TableCell>
                        {CLAIM_STATUS_LABELS[row.fromStatus] ?? row.fromStatus}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.avgHours.toFixed(1)}h
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.targetHours != null ? `${row.targetHours}h` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Math.round(row.breachRate * 100)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      ) : null}
    </AppShell>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-raised px-[18px] py-4 shadow-card">
      <div className="text-xs font-semibold uppercase tracking-[0.05em] text-ink-faint">
        {label}
      </div>
      <div className="mt-2 text-2xl font-[650] tracking-[-0.02em] tabular-nums">
        {value}
      </div>
    </div>
  );
}
