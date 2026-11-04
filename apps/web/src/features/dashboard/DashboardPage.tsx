import { useMemo } from "react";
import { AppShell } from "../../app/AppShell";
import { useClaims } from "../claims/api";
import { useQueryInbox } from "../queries/api";
import { ClaimsByStatusCard } from "./ClaimsByStatusCard";
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

  // Stamped once per mount rather than re-read on every render — keeps the
  // "time in stage" figures stable while the page sits open.
  const now = useMemo(() => Date.now(), []);

  const metrics = useMemo(
    () => computeDashboardMetrics(claims ?? [], openQueries ?? [], now),
    [claims, openQueries, now],
  );

  const isLoading = claimsLoading || queriesLoading;
  const isError = claimsError || queriesError;

  return (
    <AppShell title="Dashboard" subtitle="Across the cashless desk">
      {isLoading ? <p className="empty-state">Loading…</p> : null}
      {isError ? (
        <div className="inline-error">Couldn't load the dashboard.</div>
      ) : null}

      {!isLoading && !isError ? (
        <>
          <KpiRow metrics={metrics} />
          <div className="two-col" style={{ gridTemplateColumns: "1fr 1.5fr" }}>
            <ClaimsByStatusCard byStatus={metrics.byStatus} />
            <ClaimsTableCard claims={claims ?? []} now={now} />
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
