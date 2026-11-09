import type { ClaimStatus } from "@claimflow/contracts";
import { Donut } from "@/components/charts/Donut";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { StatusCount } from "@claimflow/contracts";

/**
 * Fixed lifecycle order, not sorted by count — a status's color must stay
 * the same claim to claim and month to month, and the slot a status takes
 * maps 1:1 onto the categorical palette's eight hues.
 *
 * There are nine statuses and eight hues, so one slice carries two of
 * them. A ninth hue is the wrong answer: the palette is eight because
 * eight is as many as stay distinguishable, and the next one would be
 * generated rather than designed. Grouping is the answer the palette
 * asks for.
 *
 * The pair to group is the one a dashboard reading is least likely to
 * separate anyway — both are "billed, and the insurer has it". Where
 * the difference is acted on it is still there in full: the claim
 * file's stepper, the list chip, receivables ageing, and the turnaround
 * report, which exists precisely to tell the two apart.
 */
const SLICES: { key: string; label: string; statuses: ClaimStatus[] }[] = [
  { key: "DRAFT", label: "Draft", statuses: ["DRAFT"] },
  { key: "PRE_AUTH_SENT", label: "Pre-auth sent", statuses: ["PRE_AUTH_SENT"] },
  { key: "QUERY_RAISED", label: "Query", statuses: ["QUERY_RAISED"] },
  {
    key: "ENHANCEMENT_REQUESTED",
    label: "Enhancement",
    statuses: ["ENHANCEMENT_REQUESTED"],
  },
  { key: "APPROVED", label: "Approved", statuses: ["APPROVED"] },
  {
    key: "BILLED",
    label: "Billed",
    statuses: ["FINAL_BILL_SUBMITTED", "DISCHARGE_AUTHORISED"],
  },
  { key: "SETTLED", label: "Settled", statuses: ["SETTLED"] },
  { key: "REJECTED", label: "Rejected", statuses: ["REJECTED"] },
];

export function ClaimsByStatusDonut({
  byStatus,
}: {
  /** Counted in the database — the browser no longer tallies the ledger. */
  byStatus: StatusCount[];
}) {
  const counts = new Map(byStatus.map((r) => [r.status, r.count]));

  const data = SLICES.map((slice, i) => ({
    key: slice.key,
    label: slice.label,
    value: slice.statuses.reduce((n, s) => n + (counts.get(s) ?? 0), 0),
    colorVar: `--series-${i + 1}`,
  })).filter((d) => d.value > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claims by status</CardTitle>
      </CardHeader>

      {data.length === 0 ? (
        <p className="px-1 py-2.5 text-base text-ink-faint">
          No claims on the desk yet.
        </p>
      ) : (
        <Donut data={data} centerLabel="Claims" />
      )}
    </Card>
  );
}
