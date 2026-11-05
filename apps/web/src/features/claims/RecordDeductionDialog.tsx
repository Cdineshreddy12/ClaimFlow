import { useState } from "react";
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
              Couldn&apos;t record that deduction.
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
