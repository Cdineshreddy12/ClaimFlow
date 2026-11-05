import { Link } from "react-router-dom";
import { needsAttention } from "@claimflow/contracts";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration } from "../../lib/format";
import { STATUS_CHIP_VARIANT, STATUS_LABEL } from "../claims/types";
import type { Claim } from "../claims/types";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * The claims waiting on the desk, longest first.
 *
 * This used to be the whole claim ledger, which made the dashboard a
 * worse version of the Claims screen. A dashboard should answer "what
 * do I do now"; the ledger answers "where is this claim". Showing the
 * same table in both taught a desk to ignore one of them.
 *
 * "Needs attention" is the same predicate the KPI above it counts, so
 * the number and the list can't disagree.
 */
export function NeedsAttentionCard({
  claims,
  now,
}: {
  claims: Claim[];
  now: number;
}) {
  const waiting = claims
    .filter((claim) => needsAttention(claim.status))
    .sort(
      (a, b) =>
        new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
        <Link
          to="/claims"
          className="text-sm font-semibold text-accent-ink no-underline hover:underline"
        >
          All claims →
        </Link>
      </CardHeader>

      {waiting.length === 0 ? (
        // Worth saying plainly rather than "no results" — an empty
        // queue here is the good outcome, not a missing one.
        <p className="px-1 py-2.5 text-base text-ink-faint">
          Nothing waiting on the desk. Every open claim is with an insurer.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Claim</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Insurer / TPA</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Waiting</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {waiting.map((claim) => (
              <TableRow key={claim.id}>
                <TableCell className="font-mono tabular-nums">
                  <Link
                    to={`/claims/${claim.id}`}
                    className="font-semibold text-accent-ink no-underline hover:underline"
                  >
                    {claim.reference}
                  </Link>
                </TableCell>
                <TableCell className="flex flex-col [&_.proc]:text-sm [&_.proc]:text-ink-faint">
                  {claim.patientName}
                  <span className="proc">{claim.procedureName}</span>
                </TableCell>
                <TableCell>{claim.insurerName}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_CHIP_VARIANT[claim.status]}>
                    {STATUS_LABEL[claim.status]}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono font-semibold tabular-nums text-critical">
                  {formatDuration(now - new Date(claim.updatedAt).getTime())}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
