import { useState } from "react";
import {
  ENHANCEMENT_STATUS_LABEL,
  isEnhancementOpen,
} from "@claimflow/contracts";
import { Button } from "@/components/ui/button";
import { formatAmount } from "../../lib/format";
import { useAuth } from "../auth/AuthProvider";
import { useClaimFinancials, useEnhancements } from "./api";
import { DecideEnhancementDialog } from "./DecideEnhancementDialog";
import { RequestEnhancementDialog } from "./RequestEnhancementDialog";
import type { Claim } from "./types";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Where this claim's money stands, and the one action that can still
 * change it.
 *
 * The four numbers here used to live in four different places and were
 * never compared: what the insurer sanctioned, what the hospital
 * expects to spend, what it billed, and what was cut. Put together they
 * produce the shortfall — and, while the patient is still admitted, the
 * only chance to prevent one (docs/adr/0012).
 *
 * The enhancement prompt is the point of the card. Everything else is
 * a record; that is a decision with a deadline.
 *
 * Entering those amounts happens from the rail's action list, with the
 * rest of the claim's actions — here they were two underlined links
 * under five numbers, which is where a desk never looked for them.
 */
export function MoneyCard({ claim }: { claim: Claim }) {
  const { role } = useAuth();
  const { data: money } = useClaimFinancials(claim.id);
  const { data: enhancements } = useEnhancements(claim.id);
  const [requesting, setRequesting] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);

  const canRecord = role === "org_admin" || role === "desk_head";
  const open = (enhancements ?? []).find((e) => isEnhancementOpen(e.status));
  const decided = (enhancements ?? []).filter(
    (e) => !isEnhancementOpen(e.status),
  );

  if (!money) return null;

  const advice = money.enhancement;

  /*
    What the deductions could legitimately be explaining: the part of
    the bill the insurer hasn't paid. Anything beyond that is
    double-counted or sitting on the wrong claim. Only checked once a
    bill exists — before that there is nothing to reconcile against.
  */
  const unpaid =
    money.billedAmount === null
      ? null
      : money.billedAmount - Number(claim.settledAmount ?? 0);
  const overRecorded =
    unpaid !== null && money.deductedAmount > Math.max(unpaid, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Money</CardTitle>
        {money.shortfall !== null && money.shortfall > 0 ? (
          <Badge variant="critical">
            {formatAmount(money.shortfall)} short
          </Badge>
        ) : null}
      </CardHeader>

      <dl className="mb-4 grid gap-x-[18px] gap-y-3.5 [grid-template-columns:repeat(auto-fit,minmax(130px,1fr))] [&_dd]:text-lg [&_dd]:font-semibold [&_dd]:text-ink [&_dt]:mb-[3px] [&_dt]:text-2xs [&_dt]:font-semibold [&_dt]:uppercase [&_dt]:tracking-[0.06em] [&_dt]:text-ink-faint">
        <div>
          <dt>Sanctioned</dt>
          <dd className="font-mono tabular-nums">
            {formatAmount(money.sanctionedAmount)}
          </dd>
        </div>
        <div>
          <dt>Expected cost</dt>
          <dd className="font-mono tabular-nums">
            {formatAmount(money.expectedCost)}
          </dd>
        </div>
        <div>
          <dt>Billed</dt>
          <dd className="font-mono tabular-nums">
            {formatAmount(money.billedAmount)}
          </dd>
        </div>
        <div>
          <dt>Received</dt>
          <dd className="font-mono tabular-nums">
            {formatAmount(claim.settledAmount)}
            {claim.settledOn ? (
              <span className="mt-0.5 block text-xs font-medium text-approved">
                on{" "}
                {new Date(`${claim.settledOn}T00:00:00`).toLocaleDateString(
                  "en-IN",
                  { day: "numeric", month: "short", year: "numeric" },
                )}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Deducted</dt>
          <dd className="font-mono tabular-nums">
            {formatAmount(money.deductedAmount)}
            {money.recoveredAmount > 0 ? (
              <span className="mt-0.5 block text-xs font-medium text-approved">
                {formatAmount(money.recoveredAmount)} recovered
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      {overRecorded ? (
        /*
          These five numbers are read together, and nothing was checking
          that they could all be true at once. A claim billed at
          ₹1,85,000 was showing ₹2,50,006 of deductions beside it — more
          than the claim was ever worth — and the panel stated both
          without comment. Deductions are typed per reason by hand, so
          the usual cause is one filed against the wrong claim.
        */
        <div className="mb-4 rounded-md border border-pending bg-pending-bg px-3 py-2.5 text-base leading-relaxed">
          <strong className="font-semibold">These don&apos;t add up.</strong>{" "}
          {formatAmount(money.deductedAmount)} of deductions is recorded against{" "}
          {formatAmount(money.billedAmount)} billed
          {claim.settledAmount ? (
            <> and {formatAmount(claim.settledAmount)} received</>
          ) : null}
          , which leaves only {formatAmount(unpaid)} it could be explaining.
          Check the list below — a deduction filed against the wrong claim looks
          exactly like this.
        </div>
      ) : null}

      {/* Utilisation gets a bar because "92% of the ceiling" is a
          position on a line, and a number alone makes the reader do the
          comparison the bar does for them. */}
      {money.utilisation !== null ? (
        <div className="mb-3.5">
          <div className="h-1.5 overflow-hidden rounded-[3px] bg-neutral-bg">
            <div
              className={`h-full transition-[width] duration-[250ms] ${
                money.utilisation >= 1
                  ? "bg-critical"
                  : money.utilisation >= 0.8
                    ? "bg-pending"
                    : "bg-approved"
              }`}
              style={{
                width: `${Math.min(money.utilisation * 100, 100).toFixed(1)}%`,
              }}
            />
          </div>
          <div className="mt-[5px] text-sm text-ink-soft">
            {Math.round(money.utilisation * 100)}% of the sanctioned amount
          </div>
        </div>
      ) : null}

      {advice.advised ? (
        <div className="mb-3 flex flex-wrap items-center gap-3.5 rounded-sm border border-line border-l-[3px] border-l-pending px-[13px] py-3">
          <div className="min-w-[200px] flex-1 text-base leading-normal text-ink-soft [&_b]:text-ink">
            <b>Ask for more cover.</b> {advice.reason}
            {advice.suggestedAmount
              ? ` Roughly ${formatAmount(advice.suggestedAmount)} would cover it.`
              : ""}
          </div>
          <Button type="button" onClick={() => setRequesting(true)}>
            Request enhancement
          </Button>
        </div>
      ) : null}

      {open ? (
        <div className="mb-3 flex flex-wrap items-center gap-3.5 rounded-sm border border-line border-l-[3px] border-l-pending px-[13px] py-3">
          <div className="min-w-[200px] flex-1 text-base leading-normal text-ink-soft [&_b]:text-ink">
            <b>{formatAmount(open.requestedAmount)} requested.</b> {open.reason}
          </div>
          {canRecord ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeciding(open.id)}
            >
              Record the answer
            </Button>
          ) : null}
        </div>
      ) : null}

      {decided.length > 0 ? (
        <ul className="mb-3 flex flex-col gap-1.5 [&_li]:flex [&_li]:justify-between [&_li]:gap-2.5 [&_li]:text-sm [&_li]:text-ink-soft">
          {decided.map((enhancement) => (
            <li key={enhancement.id}>
              <span>{ENHANCEMENT_STATUS_LABEL[enhancement.status]}</span>
              <span className="font-mono tabular-nums">
                {enhancement.approvedAmount !== null
                  ? `${formatAmount(enhancement.approvedAmount)} of ${formatAmount(enhancement.requestedAmount)}`
                  : formatAmount(enhancement.requestedAmount)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <RequestEnhancementDialog
        claim={claim}
        suggestedAmount={advice.suggestedAmount}
        open={requesting}
        onOpenChange={setRequesting}
      />
      {open ? (
        <DecideEnhancementDialog
          claim={claim}
          enhancement={open}
          open={deciding === open.id}
          onOpenChange={(next) => setDeciding(next ? open.id : null)}
        />
      ) : null}
    </Card>
  );
}
