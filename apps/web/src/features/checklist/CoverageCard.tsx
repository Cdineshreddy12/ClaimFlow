import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { useChecklistCoverage } from "./api";

/**
 * Insurer/procedure pairs the desk has opened claims on and never
 * written a checklist for.
 *
 * This is the product's quietest failure. A claim on such a pair is
 * snapshotted with an empty checklist, so the gap view reports nothing
 * missing for the rest of its life — and at settlement an empty gap
 * list reads exactly like a complete file. Worse than a wrong
 * checklist, because nothing looks wrong.
 *
 * Nothing surfaced it before: you had to pick each pair from two
 * dropdowns and notice a zero.
 *
 * Hidden entirely when every pair is covered. A card that says
 * "nothing to do" on every visit is a card people stop reading.
 */
export function CoverageCard({
  onPick,
}: {
  /** Loads the pair into the editor above, so the fix is one click from the finding. */
  onPick: (insurerId: string, procedureId: string) => void;
}) {
  const { data } = useChecklistCoverage();

  if (!data || data.uncovered.length === 0) return null;

  return (
    <Card className="mb-5 border-pending">
      <CardHeader>
        <CardTitle>No checklist yet</CardTitle>
        <Badge variant="pending">
          {data.uncoveredClaims} claim{data.uncoveredClaims === 1 ? "" : "s"}
        </Badge>
      </CardHeader>

      <p className="px-1 pb-2 text-base leading-relaxed text-ink-soft">
        Claims have been opened on these pairs with no document rules, so
        nothing was ever marked missing on them.
      </p>

      <div className="flex flex-col gap-0.5">
        {data.uncovered.map((pair) => (
          <div
            key={`${pair.insurerId}-${pair.procedureId}`}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-1 py-2.5 last:border-b-0"
          >
            <div className="min-w-0">
              <div className="text-base font-medium text-ink">
                {pair.insurerName} · {pair.procedureName}
              </div>
              <div className="text-sm text-ink-faint">
                {pair.claims} claim{pair.claims === 1 ? "" : "s"}
                {pair.activeClaims > 0
                  ? ` · ${pair.activeClaims} still open`
                  : ""}
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onPick(pair.insurerId, pair.procedureId)}
            >
              Add rules
            </Button>
          </div>
        ))}
      </div>

      {/* Says what fixing it will and won't do, in the same terms the
          editor above uses — a rule added now cannot reach back into
          the claims that prompted this (docs/adr/0001). */}
      <p className="px-1 pt-2.5 text-sm leading-relaxed text-ink-faint">
        Adding rules fixes the next claim on a pair, not the ones already open —
        those keep the empty checklist they were created with.
      </p>
    </Card>
  );
}
