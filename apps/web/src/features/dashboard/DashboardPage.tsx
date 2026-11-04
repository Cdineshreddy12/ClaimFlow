import { useMemo, useState } from "react";
import { AppShell } from "../../app/AppShell";
import { Button } from "@/components/ui/button";
import { NewClaimDialog } from "../claims/NewClaimDialog";
import { Loader } from "../../components/ui/loader";
import { useClaims } from "../claims/api";
import { useQueryInbox } from "../queries/api";
import { useDeductionsSummary } from "../deductions/api";
import { DeductionsByReasonCard } from "./DeductionsByReasonCard";
import { ClaimsTableCard } from "./ClaimsTableCard";
import { KpiRow } from "./KpiRow";
import { computeDashboardMetrics } from "./metrics";

export function DashboardPage() {
  const {
    data: claims,
    isLoading: claimsLoading,
    isError: claimsError,
  } = useClaims();
  const {
    data: openQueries,
    isLoading: queriesLoading,
    isError: queriesError,
  } = useQueryInbox("open");
  const { data: deductions } = useDeductionsSummary();

  // Stamped once per mount rather than re-read on every render — keeps the
  // "time in stage" figures stable while the page sits open.
  const now = useMemo(() => Date.now(), []);

  const metrics = useMemo(
    () => computeDashboardMetrics(claims ?? [], openQueries ?? [], now),
    [claims, openQueries, now],
  );

  const [newClaim, setNewClaim] = useState(false);

  const isLoading = claimsLoading || queriesLoading;
  const isError = claimsError || queriesError;

  return (
    <AppShell title="Dashboard" subtitle="Across the cashless desk">
      {isLoading ? <Loader label="Loading the desk…" /> : null}
      {isError ? (
        <div className="inline-error">Couldn't load the dashboard.</div>
      ) : null}

      <div className="mb-5 flex justify-end">
        <Button type="button" onClick={() => setNewClaim(true)}>
          Open a claim
        </Button>
      </div>
      <NewClaimDialog open={newClaim} onOpenChange={setNewClaim} />

      {!isLoading && !isError ? (
        <>
          <KpiRow metrics={metrics} deductions={deductions} />
          {/* Ratio lives in CSS, not an inline style — an inline
              grid-template-columns outranks every media query, which is
              exactly how this silently stayed 2-up on a phone. */}
          <div className="two-col two-col--dashboard">
            <DeductionsByReasonCard summary={deductions} />
            <ClaimsTableCard claims={claims ?? []} now={now} />
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
