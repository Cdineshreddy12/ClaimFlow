import { slaState, slaWindowFor, type ClaimStatus } from "@claimflow/contracts";
import { formatTimeLeft } from "../../lib/format";
import { useNow } from "../../lib/use-now";
import { Badge } from "@/components/ui/badge";

/**
 * The clock on one claim, as a chip.
 *
 * Reads the shared window and state helpers rather than its own
 * arithmetic, so the countdown here and the watch list agree to the
 * second. A claim with no window gets no chip at all — it isn't late,
 * it isn't waiting on anybody.
 *
 * `now` stays overridable for tests, which need a fixed clock to
 * assert against; left alone it runs.
 */
export function SlaClock({
  status,
  deadline,
  now,
}: {
  status: ClaimStatus;
  deadline: string | null;
  now?: number;
}) {
  const ticking = useNow();
  const at = now ?? ticking;
  const window = slaWindowFor(status);
  const { state, remainingMs } = slaState({ deadline, now: at, window });
  if (state === "none" || remainingMs === null) return null;

  const variant =
    state === "breached"
      ? "critical"
      : state === "due_soon"
        ? "pending"
        : state === "met"
          ? "approved"
          : "neutral";

  const label =
    state === "breached"
      ? `${formatTimeLeft(remainingMs)} overdue`
      : state === "met"
        ? "Answered in time"
        : `${formatTimeLeft(remainingMs)} left`;

  return (
    <Badge
      variant={variant}
      title={
        window ? `${window.basis} — owed by the ${window.owedBy}` : undefined
      }
    >
      {label}
    </Badge>
  );
}
