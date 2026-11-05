import { CheckIcon, CrossIcon } from "../../components/icons";
import type { Claim, ClaimGaps } from "./types";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useApplyChecklistRules, useRemoveChecklistSlot } from "./api";

export function ChecklistGapsCard({
  claim,
  gaps,
}: {
  claim: Claim;
  gaps: ClaimGaps | undefined;
}) {
  const requiredMissing = gaps?.missing.length ?? 0;
  const applyRules = useApplyChecklistRules(claim.id);
  const removeSlot = useRemoveChecklistSlot(claim.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Document Checklist · Gaps</CardTitle>
        {gaps ? (
          <Badge variant={requiredMissing > 0 ? "critical" : "approved"}>
            {requiredMissing > 0 ? `${requiredMissing} missing` : "Complete"}
          </Badge>
        ) : null}
      </CardHeader>

      {claim.checklistSnapshot.length === 0 ? (
        /*
          Stated as a warning rather than a fact. An empty checklist
          means nothing will ever be reported missing on this claim —
          which at settlement reads exactly like a complete file, so
          the one place it can be caught is here.
        */
        <div className="my-1 rounded-md border border-pending bg-pending-bg px-3 py-2.5 text-base leading-relaxed">
          <strong className="font-semibold">
            This claim has no checklist.
          </strong>{" "}
          No document rules existed for this insurer and procedure when it was
          opened, so nothing will be flagged as missing. Add rules in Checklist
          Admin for the next one, and check this claim&apos;s documents by hand.
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {removeSlot.isError ? (
            <div className="mb-1 text-sm font-medium text-critical">
              {(removeSlot.error as Error).message}
            </div>
          ) : null}
          {claim.checklistSnapshot.map((item) => {
            const present =
              gaps?.satisfied.includes(item.documentType) ?? false;
            const missing = item.required && !present;
            return (
              <div
                key={item.documentType}
                className="flex items-center gap-2.5 border-b border-line px-1 py-2.5 last:border-b-0"
              >
                <div
                  className={`flex size-5 shrink-0 items-center justify-center rounded-full [&_svg]:size-[11px] ${
                    present
                      ? "bg-approved-bg text-approved"
                      : item.required
                        ? "bg-critical-bg text-critical"
                        : "bg-neutral-bg text-neutral"
                  }`}
                >
                  {present ? (
                    <CheckIcon />
                  ) : item.required ? (
                    <CrossIcon />
                  ) : null}
                </div>
                <div
                  className={`flex-1 text-base ${missing ? "font-semibold text-critical" : "font-medium"}`}
                >
                  {item.documentType}
                </div>
                <div className="text-sm text-ink-faint">
                  {present
                    ? "Confirmed"
                    : item.required
                      ? "Missing"
                      : "Optional"}
                </div>
                {/* Only slots someone added to this claim can come off
                    again, and only while nothing is filed in them. The
                    ones from the checklist it was opened against are
                    the record of what was required (docs/adr/0001). */}
                {item.addedAt && !item.fromRules && !present ? (
                  <button
                    type="button"
                    aria-label={`Remove ${item.documentType}`}
                    title="Remove this slot — it was added to this claim by hand"
                    disabled={removeSlot.isPending}
                    onClick={() => removeSlot.mutate(item.documentType)}
                    className="shrink-0 cursor-pointer border-0 bg-transparent px-1 text-md leading-none text-ink-faint hover:text-critical"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
