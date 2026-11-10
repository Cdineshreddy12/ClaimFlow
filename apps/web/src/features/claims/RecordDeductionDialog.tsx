import { useEffect, useState } from "react";
import {
  DEDUCTION_REASON_LABEL,
  type DeductionReason,
} from "@claimflow/contracts";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRecordDeduction } from "./api";
import type { Claim } from "./types";

export function RecordDeductionDialog({
  claim,
  open,
  onOpenChange,
}: {
  claim: Claim;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState<DeductionReason | "">("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const record = useRecordDeduction(claim.id);

  /*
    Seeded with what is actually unrecovered — the bill less what the
    insurer paid. The payment dialog that sends a desk here has just
    done this arithmetic on screen; opening an empty box made them do
    it again from memory. Editable, because one payment can hide
    several reasons and only the desk knows the split.
  */
  const unpaid =
    claim.billedAmount === null
      ? null
      : Number(claim.billedAmount) - Number(claim.settledAmount ?? 0);
  useEffect(() => {
    if (open) setAmount(unpaid !== null && unpaid > 0 ? String(unpaid) : "");
  }, [open, unpaid]);

  // "Other" is a bucket, not an answer — without a note it tells the
  // dashboard nothing anyone can act on.
  const noteRequired = reason === "other";
  const valid = reason && Number(amount) > 0 && (!noteRequired || note.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    await record.mutateAsync({
      reason,
      amount: Number(amount),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setReason("");
    setAmount("");
    setNote("");
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
          title="Record a deduction"
          description={`What ${claim.insurerName} withheld on ${claim.patientName}'s claim, and why`}
        />

        <form id="record-deduction" onSubmit={submit}>
          {record.isError ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
              {/* The server's words when it has better ones. A refusal
                  for overdrawing the bill names both figures, and
                  "Couldn't record that deduction" threw that away and
                  left the desk re-typing the same amount. */}
              {record.error instanceof Error
                ? record.error.message
                : "Couldn't record that deduction."}
            </div>
          ) : null}

          <FormField label="Reason" htmlFor="reason">
            <Select
              value={reason || undefined}
              onValueChange={(v) => setReason(v as DeductionReason)}
            >
              <SelectTrigger id="reason">
                <SelectValue placeholder="Why was it withheld?" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DEDUCTION_REASON_LABEL).map(([v, label]) => (
                  <SelectItem key={v} value={v}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Amount withheld" htmlFor="amount" hint="In rupees">
            <Input
              id="amount"
              type="number"
              min={1}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </FormField>

          <FormField
            label="Note"
            htmlFor="note"
            optional={!noteRequired}
            hint={
              noteRequired
                ? "Required for 'Other' — say what it was for"
                : undefined
            }
          >
            <Input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
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
            form="record-deduction"
            disabled={!valid || record.isPending}
          >
            {record.isPending ? "Recording…" : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
