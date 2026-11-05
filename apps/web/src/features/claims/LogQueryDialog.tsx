import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { useLogQuery, useTransitionStatus } from "./api";
import type { Claim } from "./types";

/**
 * Paste the TPA's email in; the API summarises it and pulls out what
 * they're asking for and by when (docs/adr/0003). The email itself is
 * stored verbatim and stays the record — adr 0005.
 *
 * Logging a query also moves the claim to QUERY_RAISED, because those
 * are the same event as far as the desk is concerned. Two buttons for
 * one thing would just be a way to get them out of step.
 */
export function LogQueryDialog({
  claim,
  open,
  onOpenChange,
}: {
  claim: Claim;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const logQuery = useLogQuery(claim.id);
  const transition = useTransitionStatus(claim.id);

  const busy = logQuery.isPending || transition.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    await logQuery.mutateAsync({ tpaRawEmail: email.trim() });
    // Only after the query is safely stored: if the transition fails,
    // the desk still has the email rather than having lost the paste.
    if (claim.status !== "QUERY_RAISED") {
      await transition.mutateAsync("QUERY_RAISED");
    }
    setEmail("");
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          logQuery.reset();
          transition.reset();
        }
      }}
    >
      <DialogContent>
        <DialogHeader
          title="Log a query from the TPA"
          description={`${claim.insurerName} · ${claim.patientName}`}
        />

        <form id="log-query" onSubmit={submit}>
          {logQuery.isError ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
              Couldn&apos;t save the query.
            </div>
          ) : null}

          <label
            htmlFor="tpaEmail"
            className="text-[12.5px] font-semibold text-ink-soft"
          >
            Paste the email
          </label>
          <textarea
            id="tpaEmail"
            autoFocus
            rows={10}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Paste the whole email, headers and all — it's kept as the record and shown under the summary."
            className="mt-1.5 w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2.5 text-[13.5px] text-ink"
          />
          <p className="mt-2 text-[12px] text-ink-faint">
            The summary, what they&apos;re asking for, and the reply deadline
            are read from this. You can correct any of it afterwards.
          </p>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="log-query"
            disabled={!email.trim() || busy}
          >
            {busy ? "Reading…" : "Log query"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
