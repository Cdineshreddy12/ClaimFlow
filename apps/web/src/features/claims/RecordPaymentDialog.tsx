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
import { useRecordPayment, useTransitionStatus } from "./api";
import type { Claim } from "./types";

/**
 * What the insurer actually paid.
 *
 * Still its own act. The money can land well before the desk gets
 * round to the status, and that order has to stay recordable — so this
 * dialog on its own records a payment and changes nothing else.
 *
 * `thenSettle` is the other direction: the desk clicked *Mark settled*
 * on a claim with no payment on record. Settled means the money
 * arrived, so rather than refuse the click or let it through and leave
 * a settled claim with no settlement, the two are done together here.
 * The one order that is now unrecordable is settled-with-no-money,
 * which was never a real state — only an unchecked one.
 *
 * It is never inferred from "sanctioned minus deductions" — the gap
 * between those two is the thing the deductions dashboard exists to
 * measure, so deriving one from the other would make it circular.
 */
export function RecordPaymentDialog({
  claim,
  open,
  onOpenChange,
  thenSettle = false,
}: {
  claim: Claim;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Mark the claim settled once the payment is recorded. */
  thenSettle?: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState(claim.settledAmount ?? "");
  const [settledOn, setSettledOn] = useState(claim.settledOn ?? today);
  const record = useRecordPayment(claim.id);
  const settle = useTransitionStatus(claim.id);

  const value = Number(amount);
  const valid = amount !== "" && Number.isFinite(value) && value >= 0;

  const sanctioned =
    claim.sanctionedAmount === null ? null : Number(claim.sanctionedAmount);
  const short = sanctioned !== null && valid ? sanctioned - value : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    try {
      await record.mutateAsync({ settledAmount: value, settledOn });
      /*
        Sequential, and the dialog stays open if the second half fails.
        Closing on the payment alone would report success for a claim
        that is still at Discharge authorised, and the desk would have
        no way to tell from the screen which half had landed.
      */
      if (thenSettle) await settle.mutateAsync("SETTLED");
    } catch {
      /*
        Caught to stop it here, not to decide anything: both mutations
        carry their own error state and the blocks above render it.
        Without this, a refused write rejects out of an async event
        handler into nothing — an unhandled rejection in the console
        on every failed save, which is also how CI first noticed.
      */
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          record.reset();
          settle.reset();
        }
      }}
    >
      <DialogContent>
        <DialogHeader
          title={thenSettle ? "Settle the claim" : "Record the payment"}
          description={
            thenSettle
              ? `What ${claim.insurerName} paid on ${claim.patientName}'s claim. Recording it settles the claim.`
              : `What ${claim.insurerName} actually paid on ${claim.patientName}'s claim`
          }
        />

        <form id="record-payment" onSubmit={submit}>
          {record.isError ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
              {record.error instanceof Error
                ? record.error.message
                : "Couldn't record that payment."}
            </div>
          ) : null}

          {/* The payment saved and the status didn't. Said plainly,
              because the money is already recorded and re-submitting
              this form would only write the same figure again. */}
          {settle.isError ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
              {`Payment saved, but the claim couldn't be marked settled. ${
                settle.error instanceof Error ? settle.error.message : ""
              }`.trim()}
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
            disabled={!valid || record.isPending || settle.isPending}
          >
            {record.isPending || settle.isPending
              ? "Saving…"
              : thenSettle
                ? // The title already says this settles the claim, so
                  // the button need not repeat "payment": at the full
                  // label, it and Cancel overflowed the padded width
                  // of a max-w-lg dialog on a 360px screen.
                  "Record and settle"
                : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
