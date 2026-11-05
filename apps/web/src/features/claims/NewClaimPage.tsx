import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../../app/AppShell";
import { Button } from "@/components/ui/button";
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
 * Opening a claim.
 *
 * A page rather than a dialog: the insurer and procedure chosen here
 * decide which checklist gets frozen onto the claim (docs/adr/0001), so
 * this is a decision the desk may want to leave open, come back to, or
 * link someone to — none of which a modal supports. It also means the
 * two selects have room to open downward instead of fighting the
 * dialog's edge.
 */
export function NewClaimPage() {
  const navigate = useNavigate();
  const { data: insurers } = useInsurers();
  const { data: procedures } = useProcedures();
  const create = useCreateClaim();

  const [patientName, setPatientName] = useState("");
  const [insurerId, setInsurerId] = useState("");
  const [procedureId, setProcedureId] = useState("");
  const [billedAmount, setBilledAmount] = useState("");

  const valid = Boolean(patientName.trim() && insurerId && procedureId);

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
    // Straight into the file — the next thing a desk does is upload.
    // `replace` so Back goes to wherever they came from, not to an
    // empty form for a claim they already opened.
    navigate(`/claims/${claim.id}`, { replace: true });
  }

  return (
    <AppShell
      title="Open a claim"
      subtitle="The insurer and procedure decide which document checklist applies"
    >
      <form className="mx-auto w-full max-w-[620px]" onSubmit={submit}>
        <div className="rounded-lg border border-line bg-surface-raised p-[18px] shadow-card">
          {create.isError ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
              {create.error instanceof Error
                ? create.error.message
                : "Couldn't open the claim."}
            </div>
          ) : null}

          <FormField label="Patient name" htmlFor="patientName">
            <Input
              id="patientName"
              autoFocus
              autoComplete="off"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
            />
          </FormField>

          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            <FormField label="Insurer / TPA" htmlFor="insurerId">
              <Select
                value={insurerId || undefined}
                onValueChange={setInsurerId}
              >
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
          </div>

          <FormField
            label="Estimated amount"
            htmlFor="billedAmount"
            optional
            hint="In rupees — can be set later"
            className="mb-0"
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
        </div>

        <div className="mt-4 flex justify-end gap-2.5">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(-1)}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || create.isPending}>
            {create.isPending ? "Opening…" : "Open claim"}
          </Button>
        </div>
      </form>
    </AppShell>
  );
}
