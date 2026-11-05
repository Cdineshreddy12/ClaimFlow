import { useState } from "react";
import {
  DEDUCTION_APPEAL_LABEL,
  DEDUCTION_REASON_LABEL,
  isAppealOpen,
} from "@claimflow/contracts";
import { Button } from "@/components/ui/button";
import { formatAmount } from "../../lib/format";
import { useAuth } from "../auth/AuthProvider";
import { useClaimDeductions, useContestDeduction } from "../deductions/api";
import { ResolveAppealDialog } from "./ResolveAppealDialog";
import type { Claim } from "./types";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * What this claim lost, and what is being done about it.
 *
 * Deductions were write-once until docs/adr/0013: recorded, totalled,
 * and that was the end of the money. Most hospitals never contest one.
 * The appeal actions here exist to change that habit, which is why
 * "Contest" sits on the row rather than behind a menu.
 */
export function DeductionsCard({ claim }: { claim: Claim }) {
  const { role } = useAuth();
  const { data: deductions } = useClaimDeductions(claim.id);
  const contest = useContestDeduction(claim.id);
  const [resolving, setResolving] = useState<string | null>(null);

  const canAct = role === "org_admin" || role === "desk_head";
  if (!deductions || deductions.length === 0) return null;

  const cut = deductions.reduce((sum, d) => sum + Number(d.amount), 0);
  const recovered = deductions.reduce(
    (sum, d) => sum + Number(d.recoveredAmount ?? 0),
    0,
  );
  const openAppeals = deductions.filter((d) => isAppealOpen(d.appealStatus));
  const target = deductions.find((d) => d.id === resolving);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deductions &amp; appeals</CardTitle>
        <Badge variant="neutral">
          {formatAmount(cut)} cut
          {recovered > 0 ? ` · ${formatAmount(recovered)} back` : ""}
        </Badge>
      </CardHeader>

      <div className="flex flex-col gap-px overflow-hidden rounded-sm border border-line bg-line">
        {deductions.map((deduction) => (
          <div
            key={deduction.id}
            className="border-l-[3px] border-l-transparent bg-surface-raised px-[13px] py-[11px]"
          >
            <div className="flex flex-wrap items-baseline gap-[9px]">
              <span className="text-base font-semibold text-ink">
                {DEDUCTION_REASON_LABEL[deduction.reason]}
              </span>
              <span className="rounded-[3px] border border-line px-[5px] py-px text-2xs text-ink-faint">
                {DEDUCTION_APPEAL_LABEL[deduction.appealStatus]}
              </span>
              <span className="ml-auto whitespace-nowrap text-base font-semibold text-critical max-sm:ml-0 font-mono tabular-nums">
                {formatAmount(deduction.amount)}
              </span>
            </div>

            {deduction.note ? (
              <div className="mt-[3px] text-sm text-ink-soft">
                {deduction.note}
              </div>
            ) : null}

            {deduction.recoveredAmount !== null ? (
              <div className="mt-[3px] text-sm text-ink-soft">
                {Number(deduction.recoveredAmount) > 0
                  ? `${formatAmount(deduction.recoveredAmount)} recovered on appeal.`
                  : "Appealed and lost."}
                {deduction.appealNote ? ` ${deduction.appealNote}` : ""}
              </div>
            ) : null}

            {canAct && isAppealOpen(deduction.appealStatus) ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {deduction.appealStatus === "NOT_CONTESTED" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={contest.isPending}
                    onClick={() =>
                      contest.mutate({ deductionId: deduction.id })
                    }
                  >
                    Contest this
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setResolving(deduction.id)}
                >
                  Record the outcome
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {openAppeals.length > 0 ? (
        <p className="mt-[11px] text-xs leading-normal text-ink-faint">
          {openAppeals.length === 1
            ? "One deduction is still worth chasing."
            : `${openAppeals.length} deductions are still worth chasing.`}{" "}
          An appeal nobody records is an appeal nobody makes.
        </p>
      ) : null}

      {target ? (
        <ResolveAppealDialog
          claim={claim}
          deduction={target}
          open={Boolean(resolving)}
          onOpenChange={(next) => setResolving(next ? target.id : null)}
        />
      ) : null}
    </Card>
  );
}
