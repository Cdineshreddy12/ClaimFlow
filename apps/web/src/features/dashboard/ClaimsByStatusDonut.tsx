import type { ClaimStatus } from "@claimflow/contracts";
import { Donut } from "@/components/charts/Donut";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { STATUS_LABEL } from "../claims/types";
import type { StatusCount } from "@claimflow/contracts";

/**
 * Fixed lifecycle order, not sorted by count — a status's color must stay
 * the same claim to claim and month to month, and the slot a status takes
 * maps 1:1 onto the categorical palette's eight hues.
 */
const STATUS_ORDER: ClaimStatus[] = [
  "DRAFT",
  "PRE_AUTH_SENT",
  "QUERY_RAISED",
  "ENHANCEMENT_REQUESTED",
  "APPROVED",
  "FINAL_BILL_SUBMITTED",
  "SETTLED",
  "REJECTED",
];

export function ClaimsByStatusDonut({
  byStatus,
}: {
  /** Counted in the database — the browser no longer tallies the ledger. */
  byStatus: StatusCount[];
}) {
  const counts = new Map(byStatus.map((r) => [r.status, r.count]));

  const data = STATUS_ORDER.map((status, i) => ({
    key: status,
    label: STATUS_LABEL[status],
    value: counts.get(status) ?? 0,
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
