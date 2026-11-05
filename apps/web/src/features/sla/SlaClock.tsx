import { slaState, slaWindowFor, type ClaimStatus } from "@claimflow/contracts";
import { formatDuration } from "../../lib/format";
import { Badge } from "@/components/ui/badge";

/**
 * The clock on one claim, as a chip.
 *
 * Reads the shared window and state helpers rather than its own
 * arithmetic, so the countdown here and the watch list agree to the
 * minute. A claim with no window gets no chip at all — it isn't late,
 * it isn't waiting on anybody.
 */
export function SlaClock({
  status,
  deadline,
  now = Date.now(),
}: {
  status: ClaimStatus;
  deadline: string | null;
  now?: number;
}) {
  const window = slaWindowFor(status);
  const { state, remainingMs } = slaState({ deadline, now, window });
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
      ? `${formatDuration(remainingMs)} overdue`
      : state === "met"
        ? "Answered in time"
        : `${formatDuration(remainingMs)} left`;

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
