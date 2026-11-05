import { Button } from "@/components/ui/button";
import { useAuth } from "../auth/AuthProvider";
import { useApplyProposal, useChecklistProposals } from "./api";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Rules the insurers' own queries say are missing.
 *
 * Every TPA query asking for a document is evidence the checklist was
 * wrong — the insurer wanted something the rules didn't require. This
 * reads that back (docs/adr/0016).
 *
 * Proposals, never edits. docs/adr/0001 makes a rule change apply to
 * every future claim for that insurer and procedure, which is not a
 * decision to take automatically from a pattern in a dozen emails. The
 * denominator is on every row for the same reason the deduction panel
 * carries one: "9 of 14" can be argued with, "64%" can't.
 */
export function ProposalsCard() {
  const { role } = useAuth();
  const { data: proposals, isLoading } = useChecklistProposals();
  const apply = useApplyProposal();

  const canApply = role === "org_admin" || role === "desk_head";
  if (isLoading || !proposals || proposals.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Learned from TPA queries</CardTitle>
        <Badge variant="pending">{proposals.length} suggested</Badge>
      </CardHeader>

      <p className="mb-3.5 text-base leading-[1.55] text-ink-soft [&_b]:font-semibold [&_b]:text-ink">
        Each of these was asked for by the insurer on claims where your
        checklist didn&apos;t require it. Adding it applies to new claims only —
        claims already open keep the checklist they were opened against.
      </p>

      <div className="flex flex-col gap-px overflow-hidden rounded-sm border border-line bg-line">
        {proposals.map((proposal) => (
          <div
            key={`${proposal.insurerId}-${proposal.procedureId}-${proposal.documentType}`}
            className="border-l-[3px] border-l-transparent bg-surface-raised px-[13px] py-[11px]"
          >
            <div className="flex flex-wrap items-baseline gap-[9px]">
              <span className="text-base font-semibold text-ink">
                {proposal.documentType}
              </span>
              <span className="rounded-[3px] border border-line px-[5px] py-px text-2xs text-ink-faint">
                {proposal.action === "make_required"
                  ? "Already optional"
                  : "Not in the checklist"}
              </span>
            </div>
            <div className="mt-[3px] text-sm text-ink-soft">
              {proposal.insurerName} · {proposal.procedureName} — asked for on{" "}
              <b>
                {proposal.claimsRequested} of the last{" "}
                {proposal.claimsSubmitted}
              </b>{" "}
              submitted claims
            </div>
            {proposal.requestedAs.length > 0 ? (
              <div className="mt-[3px] text-sm text-ink-soft">
                Written as: {proposal.requestedAs.join("; ")}
              </div>
            ) : null}
            {canApply ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={apply.isPending}
                  onClick={() =>
                    apply.mutate({
                      insurerId: proposal.insurerId,
                      procedureId: proposal.procedureId,
                      documentType: proposal.documentType,
                      action: proposal.action,
                    })
                  }
                >
                  {proposal.action === "make_required"
                    ? "Make it required"
                    : "Add as required"}
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {apply.isError ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
          Couldn&apos;t apply that. It may already exist as a rule.
        </div>
      ) : null}
    </Card>
  );
}
