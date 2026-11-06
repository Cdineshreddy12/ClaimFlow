import { PREAUTH_FIELD_BY_KEY } from "@claimflow/contracts";
import { Button } from "@/components/ui/button";
import { useDoctorApprovals, useReviewForm } from "./api";
import { doctorVerdict } from "./doctor-verdict";
import type { Claim } from "./types";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Reads the pre-auth form against itself before it goes to an insurer.
 *
 * Insurers query arithmetic and dates far more often than clinical
 * substance, and every query costs days. Two halves, and each finding
 * says which it came from: deterministic rules for dates, sums and the
 * form's own branches, and a model for the clinical coherence the rules
 * can't see.
 *
 * Nothing here blocks a submission. "Blocker" means an insurer would
 * reject or query the form over it — the desk still decides, same rule
 * as every other AI surface here (docs/adr/0005, 0015).
 */
export function FormReviewCard({ claim }: { claim: Claim }) {
  const review = useReviewForm(claim.id);
  const result = review.data;
  const { data: approvals } = useDoctorApprovals(claim.id);
  const doctor = doctorVerdict(approvals);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Check before sending</CardTitle>
        {doctor.kind === "declined" ? (
          <Badge variant="critical">Doctor declined</Badge>
        ) : result ? (
          <Badge
            variant={
              result.blockers > 0
                ? "critical"
                : result.warnings > 0
                  ? "pending"
                  : "approved"
            }
          >
            {result.blockers > 0
              ? `${result.blockers} would come back`
              : result.warnings > 0
                ? `${result.warnings} to look at`
                : "Nothing found"}
          </Badge>
        ) : null}
      </CardHeader>

      {/* Above the findings and independent of them. This is a fact
          somebody recorded, not something a model inferred, and it does
          not wait on anyone pressing "Check the form" — the card whose
          entire job is "read this before you send" is the last place a
          clinician's refusal should be invisible. */}
      {doctor.kind === "declined" ? (
        <div className="mb-3.5 rounded-sm border border-critical border-l-[3px] border-l-critical bg-critical-bg px-[13px] py-[11px]">
          <div className="text-base font-semibold text-ink">
            {doctor.doctorName} declined to sign this off
          </div>
          {doctor.reason ? (
            <div className="mt-[5px] text-sm leading-snug text-ink">
              {doctor.reason}
            </div>
          ) : null}
          {/* Says what it is and isn't. Nothing here blocks a
              submission — same rule as every other surface on this
              screen (docs/adr/0005, 0010). */}
          <div className="mt-[5px] text-sm text-ink-soft">
            Recorded, not enforced — sending is still your call.
          </div>
        </div>
      ) : doctor.kind === "awaiting" ? (
        <div className="mb-3.5 rounded-sm border border-pending bg-pending-bg px-[13px] py-[11px] text-sm leading-snug text-ink">
          Waiting on <b className="font-semibold">{doctor.doctorName}</b>
          {doctor.viewed ? " — they've opened the link but not answered." : "."}
        </div>
      ) : null}

      {!result ? (
        <p className="mb-3.5 text-base leading-[1.55] text-ink-soft">
          Reads the confirmed fields against each other — dates in the wrong
          order, an estimate that doesn&apos;t add up, a diagnosis that
          doesn&apos;t match the procedure.
        </p>
      ) : null}

      {review.isError ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
          Couldn&apos;t run the check.
        </div>
      ) : null}

      {result && result.findings.length === 0 ? (
        <p className="px-1 py-2.5 text-base text-ink-faint">
          Nothing contradicts itself on the fields confirmed so far.
        </p>
      ) : null}

      {result && result.findings.length > 0 ? (
        <div className="flex flex-col gap-px overflow-hidden rounded-sm border border-line bg-line">
          {result.findings.map((finding) => (
            <div
              key={finding.code}
              className={`border-l-[3px] border-l-transparent bg-surface-raised px-[13px] py-[11px]${finding.severity === "blocker" ? " !border-l-critical" : ""}`}
            >
              <div className="flex flex-wrap items-baseline gap-[9px]">
                <span className="text-base font-semibold text-ink">
                  {finding.severity === "blocker"
                    ? "Would come back"
                    : "Worth a look"}
                </span>
                {/* Said on every row: a desk exec should never have to
                    guess whether a number was computed or believed. */}
                <span className="rounded-[3px] border border-line px-[5px] py-px text-2xs text-ink-faint">
                  {finding.source === "claude" ? "Clinical read" : "Rule"}
                </span>
              </div>
              <div
                className={`mt-[5px] text-sm text-ink${finding.severity === "blocker" ? " font-medium" : ""}`}
              >
                {finding.message}
              </div>
              {finding.fieldKeys.length > 0 ? (
                <div className="mt-[3px] text-sm text-ink-soft">
                  {finding.fieldKeys
                    .map((key) => PREAUTH_FIELD_BY_KEY[key]?.label ?? key)
                    .slice(0, 4)
                    .join(" · ")}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-3.5 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant={result ? "outline" : "primary"}
          disabled={review.isPending}
          onClick={() => review.mutate()}
        >
          {review.isPending
            ? "Checking…"
            : result
              ? "Check again"
              : "Check the form"}
        </Button>
        {result && !result.clinicalReviewRan ? (
          <span className="text-sm text-ink-faint">
            Rules only — the clinical read didn&apos;t run.
          </span>
        ) : null}
      </div>
    </Card>
  );
}
