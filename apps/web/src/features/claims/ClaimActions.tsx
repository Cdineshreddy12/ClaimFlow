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
import { displayFileName } from "../documents/api";
import { DoctorApprovalDialog } from "./DoctorApprovalDialog";
import { LogQueryDialog } from "./LogQueryDialog";
import { RecordDeductionDialog } from "./RecordDeductionDialog";
import { RecordFinancialsDialog } from "./RecordFinancialsDialog";
import { RecordPaymentDialog } from "./RecordPaymentDialog";
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
  DISCHARGE_AUTHORISED: "Record discharge authorisation",
  SETTLED: "Mark settled",
  REJECTED: "Mark rejected",
};

/** Rejection is terminal and settlement is irreversible — neither should look like the obvious next click. */
const DESTRUCTIVE: ClaimStatus[] = ["REJECTED"];

/**
 * The move that carries the claim forward from each state.
 *
 * Every legal transition still gets a button — this only decides which
 * one is styled as *the* next step. A row of five equally-weighted
 * buttons makes a desk read all five every time; one primary and the
 * rest quiet makes the common case a glance.
 */
const FORWARD: Partial<Record<ClaimStatus, ClaimStatus>> = {
  DRAFT: "PRE_AUTH_SENT",
  PRE_AUTH_SENT: "APPROVED",
  // QUERY_RAISED is deliberately absent: a query is answered by
  // returning to the stage it interrupted, and only the claim knows
  // which that was. See `forwardFor` below.
  ENHANCEMENT_REQUESTED: "APPROVED",
  APPROVED: "FINAL_BILL_SUBMITTED",
  FINAL_BILL_SUBMITTED: "DISCHARGE_AUTHORISED",
  DISCHARGE_AUTHORISED: "SETTLED",
};

/**
 * The move to style as *the* next step.
 *
 * A queried claim goes back where it came from. The transition table
 * has to allow both stages a query can be raised at, so without this
 * the file would offer two buttons and one of them would be refused.
 */
function forwardFor(claim: Claim): ClaimStatus | undefined {
  if (claim.status === "QUERY_RAISED") {
    return claim.queriedFrom ?? "PRE_AUTH_SENT";
  }
  return FORWARD[claim.status];
}

export function ClaimActions({ claim }: { claim: Claim }) {
  const { role } = useAuth();
  const transition = useTransitionStatus(claim.id);
  const packet = useGeneratePacket(claim.id);

  const [askDoctor, setAskDoctor] = useState(false);
  const [logQuery, setLogQuery] = useState(false);
  const [recordDeduction, setRecordDeduction] = useState(false);
  const [recordAmounts, setRecordAmounts] = useState(false);
  const [recordPayment, setRecordPayment] = useState(false);
  // Set when *Mark settled* opened the dialog rather than the money
  // button, so it finishes the job it was opened for.
  const [settleAfterPayment, setSettleAfterPayment] = useState(false);

  // Every write behind these three is requireRole("org_admin",
  // "desk_head") on the API, so offering them to a desk executive is
  // offering a 403.
  const canRecordMoney = role === "org_admin" || role === "desk_head";

  // A desk_executive can't settle, so don't offer them a button that
  // 403s — the state machine already knows, so ask it.
  const nextStatuses = CLAIM_TRANSITIONS[claim.status].to
    .filter((next) =>
      role ? canTransition(claim.status, next, role as Role) : false,
    )
    // QUERY_RAISED is never a bare status change: a query is the email
    // a TPA sent, and logging it moves the claim as a consequence. Two
    // buttons both labelled "Log a query" sat here otherwise, and the
    // one that did less was the easier to reach.
    .filter((next) => next !== "QUERY_RAISED");

  const isSettled = claim.status === "SETTLED";
  /** Money can only have arrived once an insurer has agreed to pay something. */
  const canHaveBeenPaid =
    claim.settledAmount !== null ||
    claim.status === "APPROVED" ||
    claim.status === "FINAL_BILL_SUBMITTED" ||
    claim.status === "DISCHARGE_AUTHORISED" ||
    isSettled;
  const forward = forwardFor(claim);

  /*
    The API refuses SETTLED until a payment is on record, so the click
    collects one rather than returning a 422. Only when nothing is
    recorded — a figure already there means the money arrived first,
    which is the commoner order.
  */
  function act(next: ClaimStatus) {
    if (next === "SETTLED" && claim.settledAmount === null) {
      setSettleAfterPayment(true);
      setRecordPayment(true);
      return;
    }
    transition.mutate(next);
  }

  // Forward move first, then the rest, so the eye lands on the common
  // case rather than scanning for it.
  const ordered = [...nextStatuses].sort((a, b) => {
    if (a === forward) return -1;
    if (b === forward) return 1;
    if (DESTRUCTIVE.includes(a)) return 1;
    if (DESTRUCTIVE.includes(b)) return -1;
    return 0;
  });

  return (
    <div className="flex flex-col gap-2.5 [&_a]:w-full [&_a]:justify-center [&_button]:w-full [&_button]:justify-center">
      <div className="flex flex-col gap-1.5">
        {ordered.map((next) => (
          <Button
            key={next}
            type="button"
            variant={
              DESTRUCTIVE.includes(next)
                ? "danger"
                : next === forward
                  ? "primary"
                  : "outline"
            }
            disabled={transition.isPending}
            onClick={() => act(next)}
          >
            {ACTION_LABEL[next]}
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
        {/*
          Always offered, because a TPA can write at any stage — the
          final bill is one of the commonest things they query.

          It used to be rendered as the QUERY_RAISED transition button,
          so it vanished the moment that move became illegal: on a claim
          at Final bill there was no way to record the email at all,
          though the API accepted one perfectly well.
        */}
        <Button
          type="button"
          variant="outline"
          onClick={() => setLogQuery(true)}
        >
          Log a query
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => setAskDoctor(true)}
        >
          Ask a doctor
        </Button>

        <Button
          type="button"
          variant="outline"
          disabled={packet.isPending}
          onClick={() => packet.mutate()}
        >
          {packet.isPending ? "Compiling…" : "Compile documents"}
        </Button>
      </div>

      {/* The money actions, promoted out of the Money card's footer,
          where they were two underlined links below the fold. They are
          the only writes on this screen that change what the claim is
          worth, and they were the quietest thing on it. */}
      {canRecordMoney ? (
        <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
          <Button
            type="button"
            variant="outline"
            onClick={() => setRecordAmounts(true)}
          >
            Record sanctioned or billed
          </Button>

          {/* Separate from the above: that is what the insurer agreed
              to, this is what turned up.

              Hidden until the insurer could plausibly have paid. A draft
              claim hasn't been sent, so "Record payment received" there
              was offering to book money against something no insurer has
              seen. An amount already recorded keeps the button whatever
              the status, so a wrong figure stays correctable. */}
          {canHaveBeenPaid ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSettleAfterPayment(false);
                setRecordPayment(true);
              }}
            >
              {claim.settledAmount === null
                ? "Record payment received"
                : "Update payment received"}
            </Button>
          ) : null}

          {isSettled ||
          claim.status === "FINAL_BILL_SUBMITTED" ||
          claim.status === "DISCHARGE_AUTHORISED" ? (
            // Only meaningful once an insurer has actually paid something.
            <Button
              type="button"
              variant="outline"
              onClick={() => setRecordDeduction(true)}
            >
              Record a deduction
            </Button>
          ) : null}
        </div>
      ) : null}

      {transition.isError ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical mt-3">
          {transition.error instanceof Error
            ? transition.error.message
            : "Couldn't update the claim."}
        </div>
      ) : null}

      {packet.isError ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical mt-3">
          Couldn&apos;t compile the documents.
        </div>
      ) : null}

      {packet.isSuccess ? (
        <div className="flex items-center gap-[9px] rounded-md border border-approved bg-approved-bg px-3.5 py-3 text-base text-ink mt-3 flex-wrap">
          <span>
            Documents ready · {packet.data.documentCount} document
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
              {/* The storage key, not the name anyone uploaded. Every
                  other filename on the desk goes through this; here it
                  leaked "9fdef106-a20b-…-ultrasound_report.txt" into a
                  message meant to tell someone which file to fix. */}
              {displayFileName(s.fileName)} — {s.reason}
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
      <RecordFinancialsDialog
        claim={claim}
        open={recordAmounts}
        onOpenChange={setRecordAmounts}
      />
      <RecordPaymentDialog
        claim={claim}
        open={recordPayment}
        thenSettle={settleAfterPayment}
        onOpenChange={(next) => {
          setRecordPayment(next);
          if (!next) setSettleAfterPayment(false);
        }}
      />
    </div>
  );
}
