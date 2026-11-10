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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatAmount } from "../../lib/format";
import { useDecideEnhancement } from "./api";
import type { Claim, Enhancement } from "./types";

type Outcome = "APPROVED" | "PARTIALLY_APPROVED" | "REJECTED" | "WITHDRAWN";

const OUTCOME_LABEL: Record<Outcome, string> = {
  APPROVED: "Approved in full",
  PARTIALLY_APPROVED: "Partly approved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn by us",
};

/**
 * What the insurer said. An approval raises the claim's sanctioned
 * amount by the amount granted, so this is recorded once and never
 * edited — correcting a mistake is a new fact, not a revision of this
 * one.
 */
export function DecideEnhancementDialog({
  claim,
  enhancement,
  open,
  onOpenChange,
}: {
  claim: Claim;
  enhancement: Enhancement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [outcome, setOutcome] = useState<Outcome | "">("");
  const [amount, setAmount] = useState("");
  const decide = useDecideEnhancement(claim.id);

  const needsAmount =
    outcome === "APPROVED" || outcome === "PARTIALLY_APPROVED";
  const valid = outcome && (!needsAmount || amount !== "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!outcome || !valid) return;
    try {
      await decide.mutateAsync({
        enhancementId: enhancement.id,
        outcome,
        ...(needsAmount ? { approvedAmount: Number(amount) } : {}),
      });
    } catch {
      // The mutation's own error state is what the dialog renders;
      // caught so a refused write doesn't reject out of an async event
      // handler into an unhandled rejection.
      return;
    }
    setOutcome("");
    setAmount("");
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next && outcome === "") setAmount("");
        if (!next) decide.reset();
      }}
    >
      <DialogContent>
        <DialogHeader
          title="Record the insurer's answer"
          description={`${formatAmount(enhancement.requestedAmount)} was requested: ${enhancement.reason}`}
        />

        <form id="decide-enhancement" onSubmit={submit}>
          {decide.isError ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
              Couldn&apos;t record that. It may already have an answer.
            </div>
          ) : null}

          <FormField label="Outcome" htmlFor="enhancement-outcome">
            <Select
              value={outcome || undefined}
              onValueChange={(v) => {
                setOutcome(v as Outcome);
                if (v === "APPROVED") {
                  setAmount(String(Number(enhancement.requestedAmount)));
                }
                if (v === "REJECTED" || v === "WITHDRAWN") setAmount("");
              }}
            >
              <SelectTrigger id="enhancement-outcome">
                <SelectValue placeholder="What came back?" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(OUTCOME_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          {needsAmount ? (
            <FormField
              label="Amount granted"
              htmlFor="enhancement-granted"
              hint="This is added to the claim's sanctioned amount"
            >
              <Input
                id="enhancement-granted"
                type="number"
                min={0}
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </FormField>
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
            form="decide-enhancement"
            disabled={!valid || decide.isPending}
          >
            {decide.isPending ? "Recording…" : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
