import { useState } from "react";
import { canTransition, type Role } from "@claimflow/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { useAuth } from "../auth/AuthProvider";
import { useLogQuery, useTransitionStatus } from "./api";
import type { Claim } from "./types";

/**
 * Paste the TPA's email in; the API summarises it and pulls out what
 * they're asking for and by when (docs/adr/0003). The email itself is
 * stored verbatim and stays the record — adr 0005.
 *
 * Logging a query moves the claim to QUERY_RAISED *when that move is
 * legal* — at the pre-auth stage those are the same event as far as
 * the desk is concerned, and two buttons for one thing would only be a
 * way to get them out of step.
 *
 * When it isn't legal, the query is still recorded and the claim stays
 * where it is. A TPA querying the final bill is routine, and sending
 * that claim back to "query raised" would say it is waiting on a
 * pre-auth decision it already has. The correspondence is a fact; the
 * status is where the claim sits. They are not always the same thing.
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
  const { role } = useAuth();
  const [email, setEmail] = useState("");
  const logQuery = useLogQuery(claim.id);
  const transition = useTransitionStatus(claim.id);

  const busy = logQuery.isPending || transition.isPending;

  // The state machine decides, not this dialog — so a status it has
  // never heard of behaves correctly the day it is added.
  const movesTheClaim =
    claim.status !== "QUERY_RAISED" &&
    Boolean(role) &&
    canTransition(claim.status, "QUERY_RAISED", role as Role);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    await logQuery.mutateAsync({ tpaRawEmail: email.trim() });
    // Only after the query is safely stored: if the transition fails,
    // the desk still has the email rather than having lost the paste.
    if (movesTheClaim) {
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
