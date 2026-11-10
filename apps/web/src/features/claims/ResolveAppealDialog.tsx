import { useState } from "react";
import { appealOutcomeFor, DEDUCTION_APPEAL_LABEL } from "@claimflow/contracts";
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
import { useResolveAppeal, type Deduction } from "../deductions/api";
import type { Claim } from "./types";

/**
 * What came back from the appeal.
 *
 * The outcome isn't a dropdown: it follows from the amount, so a desk
 * can't record "recovered in full" next to a partial figure. Zero is a
 * real answer — an appeal fought and lost — and recording it is what
 * stops the same reason being appealed to the same insurer forever.
 */
export function ResolveAppealDialog({
  claim,
  deduction,
  open,
  onOpenChange,
}: {
  claim: Claim;
  deduction: Deduction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const resolve = useResolveAppeal(claim.id);

  const deducted = Number(deduction.amount);
  const entered = amount === "" ? null : Number(amount);
  const tooMuch = entered !== null && entered > deducted;
  const valid = entered !== null && entered >= 0 && !tooMuch;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || entered === null) return;
    try {
      await resolve.mutateAsync({
        deductionId: deduction.id,
        recoveredAmount: entered,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
    } catch {
      // The mutation's own error state is what the dialog renders;
      // caught so a refused write doesn't reject out of an async event
      // handler into an unhandled rejection.
      return;
    }
    setAmount("");
    setNote("");
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resolve.reset();
      }}
    >
      <DialogContent>
        <DialogHeader
          title="Record the appeal's outcome"
          description={`${formatAmount(deduction.amount)} was withheld on ${claim.patientName}'s claim`}
        />

        <form id="resolve-appeal" onSubmit={submit}>
          {resolve.isError ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
              Couldn&apos;t record that outcome.
            </div>
          ) : null}

          <FormField
            label="Amount recovered"
            htmlFor="recovered"
            error={
              tooMuch
                ? `More than the ${formatAmount(deduction.amount)} withheld`
                : undefined
            }
            hint="Enter 0 if the insurer upheld the deduction"
          >
            <Input
              id="recovered"
              type="number"
              min={0}
              max={deducted}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </FormField>

          {entered !== null && !tooMuch ? (
            <p className="m-0 mb-1 text-sm leading-[1.45] text-ink-soft">
              Recorded as{" "}
              <b>
                {DEDUCTION_APPEAL_LABEL[appealOutcomeFor(deducted, entered)]}
              </b>
              .
            </p>
          ) : null}

          <FormField label="Note" htmlFor="appeal-note" optional>
            <Input
              id="appeal-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Insurer accepted the proof of dispatch"
            />
          </FormField>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="resolve-appeal"
            disabled={!valid || resolve.isPending}
          >
            {resolve.isPending ? "Recording…" : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
