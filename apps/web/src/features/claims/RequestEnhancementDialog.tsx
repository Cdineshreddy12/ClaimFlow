import { useEffect, useState } from "react";
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
import { useRequestEnhancement } from "./api";
import type { Claim } from "./types";

/**
 * Asking the insurer to raise what it sanctioned.
 *
 * The reason is required and not optional, because an insurer refuses
 * an enhancement that doesn't say what changed clinically — a blank
 * reason is a rejected request, so the form won't send one.
 */
export function RequestEnhancementDialog({
  claim,
  suggestedAmount,
  open,
  onOpenChange,
}: {
  claim: Claim;
  suggestedAmount: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const request = useRequestEnhancement(claim.id);

  /*
    Seeded with the figure the card just suggested. It said "roughly
    ₹42,400 would cover it" and then opened an empty box, so the desk
    read the number off the screen behind the dialog and typed it back
    in. Still editable — the suggestion is a starting point, and the
    insurer is being asked for whatever the desk decides.
  */
  useEffect(() => {
    if (open) setAmount(suggestedAmount ? String(suggestedAmount) : "");
  }, [open, suggestedAmount]);

  const valid = Number(amount) > 0 && reason.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    await request.mutateAsync({
      requestedAmount: Number(amount),
      reason: reason.trim(),
    });
    setAmount("");
    setReason("");
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) request.reset();
      }}
    >
      <DialogContent>
        <DialogHeader
          title="Request an enhancement"
          description={`Ask ${claim.insurerName} to raise the sanctioned amount on ${claim.patientName}'s claim`}
        />

        <form id="request-enhancement" onSubmit={submit}>
          {request.isError ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
              Couldn&apos;t send that request. If one is already open with the
              insurer, record its answer first.
            </div>
          ) : null}

          <FormField
            label="Additional amount needed"
            htmlFor="enhancement-amount"
            hint="Over and above what's already sanctioned, in rupees"
          >
            <Input
              id="enhancement-amount"
              type="number"
              min={1}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </FormField>

          <FormField
            label="What changed"
            htmlFor="enhancement-reason"
            hint="The insurer reads this. Name the clinical change — a vague reason comes back rejected."
          >
            <Input
              id="enhancement-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Converted to open surgery; two extra ICU days"
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
            form="request-enhancement"
            disabled={!valid || request.isPending}
          >
            {request.isPending ? "Sending…" : "Record the request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
