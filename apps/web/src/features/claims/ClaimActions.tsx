import { useState } from "react";
import {
  CLAIM_TRANSITIONS,
  canTransition,
  type ClaimStatus,
  type Role,
} from "@claimflow/contracts";
import { Button } from "@/components/ui/button";
import { useAuth } from "../auth/AuthProvider";
import { useGeneratePacket, useTransitionStatus } from "./api";
import { DoctorApprovalDialog } from "./DoctorApprovalDialog";
import { LogQueryDialog } from "./LogQueryDialog";
import { RecordDeductionDialog } from "./RecordDeductionDialog";
import type { Claim } from "./types";

/**
 * What the desk says happened next, phrased as the action rather than
 * the resulting state — "Mark approved", not "APPROVED". The set comes
 * from CLAIM_TRANSITIONS, so the buttons offered are exactly the moves
 * the API will accept; there is no second list to drift out of step.
 */
const ACTION_LABEL: Record<ClaimStatus, string> = {
  DRAFT: "Move back to draft",
  PRE_AUTH_SENT: "Send pre-auth",
  QUERY_RAISED: "Log a query",
  ENHANCEMENT_REQUESTED: "Request enhancement",
  APPROVED: "Mark approved",
  FINAL_BILL_SUBMITTED: "Submit final bill",
  SETTLED: "Mark settled",
  REJECTED: "Mark rejected",
};

/** Rejection is terminal and settlement is irreversible — neither should look like the obvious next click. */
const DESTRUCTIVE: ClaimStatus[] = ["REJECTED"];

export function ClaimActions({ claim }: { claim: Claim }) {
  const { role } = useAuth();
  const transition = useTransitionStatus(claim.id);
  const packet = useGeneratePacket(claim.id);

  const [askDoctor, setAskDoctor] = useState(false);
  const [logQuery, setLogQuery] = useState(false);
  const [recordDeduction, setRecordDeduction] = useState(false);

  // A desk_executive can't settle, so don't offer them a button that
  // 403s — the state machine already knows, so ask it.
  const nextStatuses = CLAIM_TRANSITIONS[claim.status].to.filter((next) =>
    role ? canTransition(claim.status, next, role as Role) : false,
  );

  const isSettled = claim.status === "SETTLED";

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-2">
        {nextStatuses.map((next) =>
          // A query is logged with its email, not by flipping a status —
          // the dialog does both, so route that one button to it.
          next === "QUERY_RAISED" ? (
            <Button
              key={next}
              type="button"
              variant="ghost"
              onClick={() => setLogQuery(true)}
            >
              {ACTION_LABEL[next]}
            </Button>
          ) : (
            <Button
              key={next}
              type="button"
              variant={DESTRUCTIVE.includes(next) ? "danger" : "primary"}
              disabled={transition.isPending}
              onClick={() => transition.mutate(next)}
            >
              {ACTION_LABEL[next]}
            </Button>
          ),
        )}

        <span className="mx-1 hidden h-5 w-px bg-line-strong sm:block" />

        <Button
          type="button"
          variant="ghost"
          onClick={() => setAskDoctor(true)}
        >
          Ask a doctor
        </Button>

        <Button
          type="button"
          variant="ghost"
          disabled={packet.isPending}
          onClick={() => packet.mutate()}
        >
          {packet.isPending ? "Building…" : "Build packet"}
        </Button>

        {isSettled || claim.status === "FINAL_BILL_SUBMITTED" ? (
          // Only meaningful once an insurer has actually paid something.
          <Button
            type="button"
            variant="ghost"
            onClick={() => setRecordDeduction(true)}
          >
            Record a deduction
          </Button>
        ) : null}
      </div>

      {transition.isError ? (
        <div className="inline-error mt-3">
          {transition.error instanceof Error
            ? transition.error.message
            : "Couldn't update the claim."}
        </div>
      ) : null}

      {packet.isError ? (
        <div className="inline-error mt-3">Couldn&apos;t build the packet.</div>
      ) : null}

      {packet.isSuccess ? (
        <div className="sent-confirm mt-3 flex-wrap">
          <span>
            Packet ready · {packet.data.documentCount} document
            {packet.data.documentCount === 1 ? "" : "s"}
            {packet.data.skipped.length > 0
              ? ` · ${packet.data.skipped.length} couldn't be included`
              : ""}
          </span>
          <a
            href={packet.data.downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-accent-ink underline"
          >
            Open
          </a>
        </div>
      ) : null}

      {/* Named, not counted — "1 couldn't be included" tells a desk
          nothing they can act on. */}
      {packet.isSuccess && packet.data.skipped.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {packet.data.skipped.map((s) => (
            <li key={s.fileName} className="text-[12px] text-ink-faint">
              {s.fileName} — {s.reason}
            </li>
          ))}
        </ul>
      ) : null}

      <DoctorApprovalDialog
        claim={claim}
        open={askDoctor}
        onOpenChange={setAskDoctor}
      />
      <LogQueryDialog
        claim={claim}
        open={logQuery}
        onOpenChange={setLogQuery}
      />
      <RecordDeductionDialog
        claim={claim}
        open={recordDeduction}
        onOpenChange={setRecordDeduction}
      />
    </div>
  );
}
