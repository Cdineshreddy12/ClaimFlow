import { Link } from "react-router-dom";
import { AppShell } from "../../app/AppShell";
import { BarChart } from "@/components/charts/BarChart";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader } from "../../components/ui/loader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAmount } from "@/lib/format";
import { useAgeing } from "./api";

/**
 * What the hospital is owed, and for how long.
 *
 * The product measured what insurers *cut* (docs/adr/0011) and how
 * long they take to *decide* (0014), and never what is simply sitting
 * unpaid. Cash timing is the thing a CFO manages before either — money
 * approved and not yet arrived decides whether a month is comfortable.
 *
 * The clock runs from the final bill, not from admission: before the
 * bill goes in nothing is owed, and ageing from earlier would fold the
 * hospital's own turnaround into a number meant to measure the
 * insurer's.
 */
export function ReceivablesPage() {
  const { data, isLoading, isError } = useAgeing();

  return (
    <AppShell title="Receivables" subtitle="What's owed, by age and by insurer">
      {isLoading ? <Loader label="Adding up what's owed…" /> : null}
      {isError ? (
        <div className="rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
          Couldn&apos;t load the ageing report.
        </div>
      ) : null}

      {data ? (
        <>
          {/* Four numbers and a headline — a stat row, not a chart.
              Bucketed totals are read, not compared by eye. */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:[grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
            <div className="rounded-lg border border-line bg-surface-raised px-[18px] py-4 shadow-card">
              <div className="text-xs font-semibold uppercase tracking-[0.05em] text-ink-faint">
                Total outstanding
              </div>
              <div className="mt-2 text-2xl font-[650] tracking-[-0.02em] tabular-nums">
                {formatAmount(data.total)}
              </div>
              <div className="mt-1.5 text-sm text-ink-soft">
                Across {data.claims} billed claim{data.claims === 1 ? "" : "s"}
              </div>
            </div>

            {data.buckets.map((bucket) => (
              <div
                key={bucket.key}
                className={`rounded-lg border border-line bg-surface-raised px-[18px] py-4 shadow-card${
                  // Only the oldest bucket gets the warning rule. Money
                  // past ninety days is the part that stops being late
                  // and starts being doubtful.
                  bucket.key === "over_90" && bucket.total > 0
                    ? " border-t-2 border-t-critical pt-[15px]"
                    : ""
                }`}
              >
                <div className="text-xs font-semibold uppercase tracking-[0.05em] text-ink-faint">
                  {bucket.label}
                </div>
                <div className="mt-2 text-2xl font-[650] tracking-[-0.02em] tabular-nums">
                  {formatAmount(bucket.total)}
                </div>
                <div className="mt-1.5 text-sm text-ink-soft">
                  {bucket.claims} claim{bucket.claims === 1 ? "" : "s"}
                </div>
              </div>
            ))}
          </div>

          {data.byInsurer.length > 0 ? (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Outstanding by insurer</CardTitle>
              </CardHeader>
              <div className="px-[18px] pb-[18px]">
                <BarChart
                  data={data.byInsurer.map((i) => ({
                    key: i.insurerName,
                    label: i.insurerName,
                    value: i.total,
                  }))}
                  formatValue={formatAmount}
                />
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Oldest unpaid</CardTitle>
            </CardHeader>
            {data.oldest.length === 0 ? (
              <p className="px-[18px] pb-[18px] text-base text-ink-faint">
                Nothing is outstanding — every billed claim has been settled.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Claim</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Insurer</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.oldest.map((claim) => (
                    <TableRow key={claim.claimId}>
                      <TableCell>
                        <Link
                          to={`/claims/${claim.claimId}`}
                          className="font-mono font-semibold tabular-nums text-accent-ink no-underline hover:underline"
                        >
                          {claim.reference ?? "—"}
                        </Link>
                      </TableCell>
                      <TableCell>{claim.patientName}</TableCell>
                      <TableCell>{claim.insurerName}</TableCell>
                      <TableCell
                        className={`text-right font-mono tabular-nums${
                          claim.days > 90 ? " font-semibold text-critical" : ""
                        }`}
                      >
                        {claim.days}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatAmount(claim.outstanding)}
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
