import { formatAmount } from "../../lib/format";
import { useDeductionRisk } from "../deductions/api";
import {
  describeScope,
  formatCost,
  formatHeadline,
  formatRate,
  formatRatePercent,
  isUrgent,
  reasonLabel,
  riskAction,
} from "../deductions/risk";
import type { Claim } from "./types";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * What this hospital has historically lost on claims like this one,
 * while the claim can still be changed.
 *
 * Deliberately shaped as evidence rather than a verdict. Each row says
 * what happened (7 of the last 12), what it cost, and what to do, so a
 * desk exec can disagree with it — the same standard docs/adr/0005
 * holds the AI surfaces to, applied to a statistic. There is no score
 * and no prediction, because neither could be checked.
 *
 * Renders nothing at all until the history is big enough to mean
 * something. A hospital in its first month should not be shown
 * percentages drawn from two claims.
 */
export function DeductionRiskCard({ claim }: { claim: Claim }) {
  const { data } = useDeductionRisk(claim.id);

  if (!data || !data.enoughHistory || data.risks.length === 0) return null;

  const urgent = data.risks.filter(isUrgent);
  const atStake = data.risks
    .filter((r) => r.avoidable)
    .reduce((sum, r) => sum + r.expectedCost, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deduction risk · from your history</CardTitle>
        <Badge variant={urgent.length > 0 ? "critical" : "neutral"}>
          {urgent.length > 0
            ? `${urgent.length} to act on`
            : "Nothing outstanding"}
        </Badge>
      </CardHeader>

      <p className="mb-3.5 text-base leading-[1.55] text-ink-soft [&_b]:font-semibold [&_b]:text-ink">
        Across <b>{data.claimsConsidered}</b> settled{" "}
        {describeScope(data.scope, claim.insurerName, claim.procedureName)}{" "}
        claims, about <b>{formatAmount(Math.round(atStake))}</b> of preventable
        deductions per claim.
      </p>

      <div className="flex flex-col gap-px overflow-hidden rounded-sm border border-line bg-line">
        {data.risks.map((risk) => {
          const action = riskAction(risk);
          const headline = formatHeadline(risk);
          return (
            <div
              key={risk.reason}
              className={`border-l-[3px] border-l-transparent bg-surface-raised px-[13px] py-[11px]${isUrgent(risk) ? " !border-l-critical" : ""}`}
            >
              <div className="flex flex-wrap items-baseline gap-[9px]">
                <span className="text-base font-semibold text-ink">
                  {reasonLabel(risk)}
                </span>
                {!risk.avoidable ? (
                  <span className="rounded-[3px] border border-line px-[5px] py-px text-2xs text-ink-faint">
                    Not preventable at the desk
                  </span>
                ) : null}
                <span
                  className={`ml-auto whitespace-nowrap text-base font-semibold max-sm:ml-0 font-mono tabular-nums${
                    headline.lost ? " text-critical" : " text-ink-soft"
                  }`}
                >
                  {headline.text}
                </span>
              </div>
              <div className="mt-[3px] text-sm text-ink-soft">
                <span className="font-mono tabular-nums">
                  {formatRatePercent(risk)}
                </span>{" "}
                {formatRate(risk)} claims · {formatCost(risk)}
              </div>
              {action ? (
                <div className="mt-[5px] text-sm text-ink">{action}</div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Said once, plainly: this is their own ledger read back to them,
          not a model's opinion. It's the sentence that makes the panel
          arguable instead of oracular. */}
      <p className="mt-[11px] text-xs leading-normal text-ink-faint">
        Counted from deductions your team recorded on settled claims. Nothing
        here is a prediction.
      </p>
    </Card>
  );
}
