import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { useInsurers, useProcedures } from "../checklist/api";
import { useCreateClaim } from "./api";

/**
 * Opening a claim. The insurer and procedure aren't optional metadata —
 * together they decide which checklist gets frozen onto the claim
 * (docs/adr/0001), so getting them right here is what makes the gap
 * view mean anything afterwards.
 */
export function NewClaimDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { data: insurers } = useInsurers();
  const { data: procedures } = useProcedures();
  const create = useCreateClaim();

  const [patientName, setPatientName] = useState("");
  const [insurerId, setInsurerId] = useState("");
  const [procedureId, setProcedureId] = useState("");
  const [billedAmount, setBilledAmount] = useState("");

  const valid = patientName.trim() && insurerId && procedureId;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const claim = await create.mutateAsync({
      patientName: patientName.trim(),
      insurerId,
      procedureId,
      ...(Number(billedAmount) > 0
        ? { billedAmount: Number(billedAmount) }
        : {}),
    });
    onOpenChange(false);
    setPatientName("");
    setInsurerId("");
    setProcedureId("");
    setBilledAmount("");
    // Straight into the file — the next thing a desk does is upload.
    navigate(`/claims/${claim.id}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) create.reset();
      }}
    >
      <DialogContent>
        <DialogHeader
          title="Open a claim"
          description="The insurer and procedure decide which document checklist applies."
        />

        <form id="new-claim" onSubmit={submit}>
          {create.isError ? (
            <div className="inline-error">
              {create.error instanceof Error
                ? create.error.message
                : "Couldn't open the claim."}
            </div>
          ) : null}

          <FormField label="Patient name" htmlFor="patientName">
            <Input
              id="patientName"
              autoFocus
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
            />
          </FormField>

          <FormField label="Insurer / TPA" htmlFor="insurerId">
            <Select value={insurerId || undefined} onValueChange={setInsurerId}>
              <SelectTrigger id="insurerId">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {insurers?.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name} · {i.type === "tpa" ? "TPA" : "Insurer"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Procedure" htmlFor="procedureId">
            <Select
              value={procedureId || undefined}
              onValueChange={setProcedureId}
            >
              <SelectTrigger id="procedureId">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {procedures?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField
            label="Estimated amount"
            htmlFor="billedAmount"
            optional
            hint="In rupees — can be set later"
          >
            <Input
              id="billedAmount"
              type="number"
              min={1}
              inputMode="numeric"
              value={billedAmount}
              onChange={(e) => setBilledAmount(e.target.value)}
            />
          </FormField>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="new-claim"
            disabled={!valid || create.isPending}
          >
            {create.isPending ? "Opening…" : "Open claim"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
