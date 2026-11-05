import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { formatAmount } from "../../lib/format";
import { useRecordPayment } from "./api";
import type { Claim } from "./types";

/**
 * What the insurer actually paid.
 *
 * Deliberately a separate act from marking the claim settled. The money
 * can land before or after the desk updates the status, and tying them
 * together would make one of those orders impossible to record
 * honestly.
 *
 * It is also never inferred from "sanctioned minus deductions" — the
 * gap between those two is the thing the deductions dashboard exists to
 * measure, so deriving one from the other would make it circular.
 */
export function RecordPaymentDialog({
  claim,
  open,
  onOpenChange,
}: {
  claim: Claim;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState(claim.settledAmount ?? "");
  const [settledOn, setSettledOn] = useState(claim.settledOn ?? today);
  const record = useRecordPayment(claim.id);

  const value = Number(amount);
  const valid = amount !== "" && Number.isFinite(value) && value >= 0;

  const sanctioned =
    claim.sanctionedAmount === null ? null : Number(claim.sanctionedAmount);
  const short = sanctioned !== null && valid ? sanctioned - value : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    await record.mutateAsync({ settledAmount: value, settledOn });
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) record.reset();
      }}
    >
      <DialogContent>
        <DialogHeader
          title="Record the payment"
          description={`What ${claim.insurerName} actually paid on ${claim.patientName}'s claim`}
        />

        <form id="record-payment" onSubmit={submit}>
          {record.isError ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
              {record.error instanceof Error
                ? record.error.message
                : "Couldn't record that payment."}
            </div>
          ) : null}

          <FormField
            label="Amount received"
            htmlFor="settledAmount"
            hint="In rupees. Zero is valid — a fully deducted claim is still settled."
          >
            <Input
              id="settledAmount"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </FormField>

          <FormField
            label="Date received"
            htmlFor="settledOn"
            hint="The day the money arrived, not the day you're recording it"
          >
            <Input
              id="settledOn"
              type="date"
              max={today}
              value={settledOn}
              onChange={(e) => setSettledOn(e.target.value)}
            />
          </FormField>

          {/* Shown live so a shortfall is noticed here, not a month
              later on the deductions report. */}
          {short !== null && short > 0 ? (
            <p className="m-0 mb-1 text-sm leading-[1.45] text-critical">
              {formatAmount(String(short))} less than the{" "}
              {formatAmount(claim.sanctionedAmount)} sanctioned. Record a
              deduction against the claim so it shows up as recoverable.
            </p>
          ) : null}
          {short !== null && short === 0 ? (
            <p className="m-0 mb-1 text-sm leading-[1.45] text-ink-soft">
              Paid in full against the sanction.
            </p>
          ) : null}
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="record-payment"
            disabled={!valid || record.isPending}
          >
            {record.isPending ? "Saving…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
