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
import { useDoctorApprovals, useRequestDoctorApproval } from "./api";
import type { Claim } from "./types";

/**
 * Mints a link for a named doctor. ClaimFlow doesn't send it —
 * docs/adr/0005 keeps every outbound message a human action — so the
 * dialog's job after minting is to hand over something copyable for
 * whatever channel the desk already uses.
 */
export function DoctorApprovalDialog({
  claim,
  open,
  onOpenChange,
}: {
  claim: Claim;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [doctorName, setDoctorName] = useState("");
  const [copied, setCopied] = useState(false);
  const request = useRequestDoctorApproval(claim.id);
  const { data: existing } = useDoctorApprovals(claim.id);

  const link = request.data
    ? `${window.location.origin}/doctor-approval/${request.data.token}`
    : null;

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
  }

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      request.reset();
      setDoctorName("");
      setCopied(false);
    }
  }

  const decided = (existing ?? []).filter((a) => a.approvedAt || a.declinedAt);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader
          title="Ask a doctor to approve the notes"
          description={`${claim.patientName} · ${claim.procedureName}`}
        />

        {link ? (
          <>
            <p className="mb-3 text-[13.5px] text-ink-soft">
              Send this to {request.data!.doctorName}. It works on a phone with
              no login, and expires in 48 hours.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={link} onFocus={(e) => e.target.select()} />
              <Button type="button" variant="ghost" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="mt-3 text-[12px] text-ink-faint">
              ClaimFlow doesn&apos;t send this for you — share it however you
              already reach them.
            </p>
          </>
        ) : (
          <form
            id="ask-doctor"
            onSubmit={(e) => {
              e.preventDefault();
              if (doctorName.trim()) request.mutate(doctorName.trim());
            }}
          >
            {request.isError ? (
              <div className="inline-error">Couldn&apos;t create the link.</div>
            ) : null}
            <FormField
              label="Doctor's name"
              htmlFor="doctorName"
              hint="Shown to them on the page, and recorded against the claim"
            >
              <Input
                id="doctorName"
                autoFocus
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
              />
            </FormField>
          </form>
        )}

        {decided.length > 0 ? (
          <div className="mt-5 border-t border-line pt-4">
            <div className="label-eyebrow mb-2">Earlier responses</div>
            <ul className="flex flex-col gap-1.5">
              {decided.map((a) => (
                <li key={a.id} className="text-[13px]">
                  <span className="font-semibold">{a.doctorName}</span>{" "}
                  {a.approvedAt ? (
                    <span className="text-approved">approved</span>
                  ) : (
                    <span className="text-critical">
                      asked for changes — {a.declineReason}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {link ? "Done" : "Cancel"}
            </Button>
          </DialogClose>
          {!link ? (
            <Button
              type="submit"
              form="ask-doctor"
              disabled={!doctorName.trim() || request.isPending}
            >
              {request.isPending ? "Creating…" : "Create link"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
