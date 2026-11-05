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
import { useUpdateFinancials } from "./api";
import type { Claim } from "./types";

/**
 * The two amounts that arrive from outside the pre-auth form: what the
 * insurer authorised, and what the hospital finally billed.
 *
 * Deliberately not part of the 24-field form. That form holds what the
 * hospital *asked* for; these are the answer and the invoice, they
 * arrive at different times, and conflating them with the estimate is
 * what made every shortfall read as zero (docs/adr/0012).
 */
export function RecordFinancialsDialog({
  claim,
  open,
  onOpenChange,
}: {
  claim: Claim;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [sanctioned, setSanctioned] = useState(claim.sanctionedAmount ?? "");
  const [billed, setBilled] = useState(claim.billedAmount ?? "");
  const update = useUpdateFinancials(claim.id);

  const changed =
    sanctioned !== (claim.sanctionedAmount ?? "") ||
    billed !== (claim.billedAmount ?? "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!changed) return;
    await update.mutateAsync({
      ...(sanctioned !== (claim.sanctionedAmount ?? "") && sanctioned !== ""
        ? { sanctionedAmount: Number(sanctioned) }
        : {}),
      ...(billed !== (claim.billedAmount ?? "") && billed !== ""
        ? { billedAmount: Number(billed) }
        : {}),
    });
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) update.reset();
      }}
    >
      <DialogContent>
        <DialogHeader
          title="Record the claim's amounts"
          description={`What ${claim.insurerName} authorised, and what was billed`}
        />

        <form id="record-financials" onSubmit={submit}>
          {update.isError ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
              Couldn&apos;t save those amounts.
            </div>
          ) : null}

          <FormField
            label="Sanctioned amount"
            htmlFor="sanctioned"
            hint="What the insurer authorised, including approved enhancements"
          >
            <Input
              id="sanctioned"
              type="number"
              min={0}
              inputMode="numeric"
              value={sanctioned}
              onChange={(e) => setSanctioned(e.target.value)}
            />
          </FormField>

          <FormField
            label="Billed amount"
            htmlFor="billed"
            hint="The final bill raised at discharge"
          >
            <Input
              id="billed"
              type="number"
              min={0}
              inputMode="numeric"
              value={billed}
              onChange={(e) => setBilled(e.target.value)}
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
            form="record-financials"
            disabled={!changed || update.isPending}
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
