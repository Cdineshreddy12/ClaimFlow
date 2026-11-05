import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatAmount } from "../../lib/format";
import { downloadPreauthForm } from "./api";
import { ClaimActions } from "./ClaimActions";
import type { Claim, ClaimGaps } from "./types";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * The facts and the actions, pinned beside the work.
 *
 * This replaces a four-card "Claim details" strip that repeated the
 * procedure, the insurer and the admission date already printed in the
 * header two inches above it — four cards to carry one new fact, the
 * billed amount. What's left here is what the header doesn't say.
 *
 * The actions live here rather than above the content because they're
 * the answer to "what now", which is a question you ask after reading
 * the gaps, not before.
 *
 * `--rail-top` is set by the page from the measured height of its
 * sticky header, so the rail pins directly below it instead of behind
 * it. The max-height is the matching half: with seven buttons and the
 * glance card the rail can outgrow a laptop viewport, and a pinned
 * element taller than the screen has a bottom nobody can reach.
 */
export function ClaimSummaryRail({
  claim,
  gaps,
}: {
  claim: Claim;
  gaps: ClaimGaps | undefined;
}) {
  const missing = gaps?.missing.length ?? 0;
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  return (
    <aside className="static flex flex-col gap-3.5 xl:sticky xl:top-[var(--rail-top,1.25rem)] xl:max-h-[calc(100vh_-_var(--rail-top,1.25rem)_-_20px)] xl:overflow-y-auto xl:overscroll-contain">
      <Card>
        <CardHeader>
          <CardTitle>What now</CardTitle>
        </CardHeader>
        <ClaimActions claim={claim} />
        {/* The form itself, as opposed to Compile documents, which merges
            the attachments. A TPA wants both. */}
        <div className="mt-2.5 border-t border-line pt-2.5 [&_button]:w-full [&_button]:justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={printing}
            onClick={async () => {
              setPrinting(true);
              setPrintError(null);
              try {
                await downloadPreauthForm(claim.id, claim.reference);
              } catch {
                setPrintError("Couldn't generate the form.");
              } finally {
                setPrinting(false);
              }
            }}
          >
            {printing ? "Generating…" : "Print claim form"}
          </Button>
          {printError ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical mt-2">
              {printError}
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>At a glance</CardTitle>
        </CardHeader>
        <dl className="m-0 flex flex-col gap-3 [&>div]:flex [&>div]:items-baseline [&>div]:justify-between [&>div]:gap-2.5 [&_dd]:m-0 [&_dd]:text-right [&_dd]:text-base [&_dd]:font-semibold [&_dt]:text-sm [&_dt]:text-ink-faint">
          <div>
            <dt>Billed amount</dt>
            <dd className="font-mono tabular-nums">
              {formatAmount(claim.billedAmount)}
            </dd>
          </div>
          <div>
            <dt>Received</dt>
            <dd className="font-mono tabular-nums">
              {formatAmount(claim.settledAmount)}
            </dd>
          </div>
          <div>
            <dt>Admitted</dt>
            <dd className="font-mono tabular-nums">
              {formatDate(claim.admittedAt)}
            </dd>
          </div>
          <div>
            <dt>Documents</dt>
            <dd>
              {claim.checklistSnapshot.length === 0 ? (
                <span className="font-medium text-ink-faint">No checklist</span>
              ) : missing > 0 ? (
                <span className="text-critical">{missing} missing</span>
              ) : (
                <span className="text-approved">Complete</span>
              )}
            </dd>
          </div>
        </dl>
      </Card>
    </aside>
  );
}
