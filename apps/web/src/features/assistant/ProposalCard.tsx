import { useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { DEDUCTION_REASON_LABEL } from "@claimflow/contracts";
import { formatAmount } from "../../lib/format";
import { useAppealWorklist } from "../deductions/api";
import { useApproveProposal } from "./api";
import type { AssistantAttachment, Proposal } from "./types";

/**
 * The permission step.
 *
 * Every write the assistant can reach is one of these: a plain-English
 * statement of what would happen, what it was inferred from, and a
 * button. Nothing here is a progress indicator for something already
 * underway — until someone clicks, nothing has been filed, logged or
 * recorded. That is docs/adr/0005's rule carried from fields to
 * actions, and it's why the model is never given a tool that writes.
 *
 * The slot is editable before approval on purpose: correcting a wrong
 * guess in place is a second of work, where "dismiss and go find the
 * claim yourself" is the whole task back again.
 */
export function ProposalCard({
  proposal,
  attachments,
  conversationId,
  alreadyApproved = false,
}: {
  proposal: Proposal;
  attachments: AssistantAttachment[];
  conversationId?: string | null;
  /**
   * Recorded on the conversation when this card was approved before.
   *
   * Reopening last week's thread used to offer to file a document that
   * was filed last week; the approval failed honestly with a 409, but a
   * button whose only job is to tell you it shouldn't exist is how a
   * desk learns to distrust the panel.
   */
  alreadyApproved?: boolean;
}) {
  const approve = useApproveProposal();
  const [dismissed, setDismissed] = useState(false);
  /*
    The deductions are read from the server, never from the proposal.
    The model passes ids and nothing else on purpose: a card whose
    figures came from the model would be asking the desk to approve
    the model's arithmetic, and the amount is the whole basis of the
    decision. Only fetched for the card that needs it.
  */
  const worklist = useAppealWorklist(
    undefined,
    proposal.kind === "open_appeal",
  );
  const attachment = attachments.find(
    (a) => a.id === proposal.input.attachment_id,
  );
  const [slot, setSlot] = useState(
    typeof proposal.input.checklist_slot === "string"
      ? proposal.input.checklist_slot
      : "",
  );

  if (dismissed) return null;

  const done = approve.isSuccess || alreadyApproved;
  const slots = attachment?.suggestedClaim?.checklistSlots ?? [];
  const claimLabel = attachment?.suggestedClaim
    ? `${attachment.suggestedClaim.reference ?? "this claim"} — ${attachment.suggestedClaim.patientName}`
    : null;
  const confidence =
    attachment?.claimConfidence !== null && attachment?.claimConfidence
      ? Math.round(Number(attachment.claimConfidence) * 100)
      : null;

  /*
    The proposal's ids, resolved against the worklist and narrowed to
    the ones still worth a click. An id the model invented, or one
    someone contested in the meantime, simply isn't here — which is
    also what makes the empty case meaningful rather than a blank list.
  */
  const proposedIds = Array.isArray(proposal.input.deduction_ids)
    ? (proposal.input.deduction_ids as unknown[]).filter(
        (id): id is string => typeof id === "string",
      )
    : [];
  const rows = (worklist.data ?? []).filter(
    (row) =>
      proposedIds.includes(row.id) && row.appealStatus === "NOT_CONTESTED",
  );
  const total = rows.length
    ? rows.reduce((sum, row) => sum + Number(row.amount), 0)
    : null;

  /** What actually happened, once the server has said. */
  const result = approve.data as
    { opened?: unknown[]; alreadyOpen?: unknown[] } | undefined;
  const outcome =
    proposal.kind === "open_appeal" && result
      ? [
          `${result.opened?.length ?? 0} opened`,
          result.alreadyOpen?.length
            ? `${result.alreadyOpen.length} already contested`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  function payload(): Record<string, unknown> {
    if (proposal.kind === "open_appeal") {
      // The ids the card actually showed, not the ones the model
      // proposed: approving what was on screen is the whole point of
      // the step, and the two differ whenever the worklist has moved.
      return { deduction_ids: rows.map((row) => row.id) };
    }
    if (proposal.kind !== "file_document") return proposal.input;
    return { ...proposal.input, checklist_slot: slot };
  }

  return (
    <div
      className={`rounded-md border px-3 py-2.5 text-base ${
        done
          ? "border-approved bg-approved-bg"
          : "border-line bg-surface-raised"
      }`}
    >
      <div className="mb-1.5 text-2xs font-bold uppercase tracking-[0.05em] text-accent-ink">
        {done ? "Done" : "Needs your approval"}
      </div>

      {proposal.kind === "file_document" ? (
        <>
          <div className="font-semibold [overflow-wrap:anywhere]">
            {attachment?.fileName ?? "This file"}
          </div>
          <div className="mt-0.5 text-sm text-ink-soft">
            {claimLabel
              ? `File onto ${claimLabel}`
              : "File onto the proposed claim"}
            {confidence !== null ? ` · ${confidence}% sure` : ""}
          </div>
          {/* The quote is the point of the card — "it says CLM-0001 on
              it" and "the patient's name matches" are very different
              levels of proof, and only a human can tell which one this
              situation needed. */}
          {attachment?.recognitionReason ? (
            <blockquote className="m-0 mt-1.5 border-l-2 border-line-strong pl-2 text-sm leading-[1.45] text-ink-faint">
              {attachment.recognitionReason}
            </blockquote>
          ) : null}

          <div className="mt-2">
            <div className="mb-1 text-2xs font-semibold uppercase tracking-[0.06em] text-ink-faint">
              Checklist slot
            </div>
            {done || slots.length === 0 ? (
              <div className="text-base font-medium">{slot || "—"}</div>
            ) : (
              <Select value={slot || undefined} onValueChange={setSlot}>
                <SelectTrigger aria-label="Checklist slot">
                  <SelectValue placeholder="Pick a slot…" />
                </SelectTrigger>
                <SelectContent>
                  {slots.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </>
      ) : null}

      {proposal.kind === "log_query" ? (
        <>
          <div className="font-semibold">Log this as a TPA query</div>
          <blockquote className="m-0 mt-1.5 max-h-24 overflow-y-auto border-l-2 border-line-strong pl-2 text-sm leading-[1.45] text-ink-faint">
            {String(proposal.input.tpa_raw_email ?? "")}
          </blockquote>
          <div className="mt-1.5 text-sm text-ink-faint">
            The email is stored as the record; a summary is read from it
            afterwards.
          </div>
        </>
      ) : null}

      {proposal.kind === "mark_query_replied" ? (
        <>
          <div className="font-semibold">Mark this query as replied</div>
          <div className="mt-0.5 text-sm text-ink-faint">
            Records that you sent a reply through your own channel. Nothing is
            sent from here.
          </div>
        </>
      ) : null}

      {proposal.kind === "file_as_new_slot" ? (
        <>
          <div className="font-semibold [overflow-wrap:anywhere]">
            {attachment?.fileName ?? "This file"}
          </div>
          <div className="mt-0.5 text-sm text-ink-soft">
            Add a &ldquo;{String(proposal.input.checklist_slot ?? "")}&rdquo;
            slot to {claimLabel ?? "this claim"} and file it there
          </div>
          {attachment?.recognitionReason ? (
            <blockquote className="m-0 mt-1.5 border-l-2 border-line-strong pl-2 text-sm leading-[1.45] text-ink-faint">
              {attachment.recognitionReason}
            </blockquote>
          ) : null}
          {/* The counterpart to the add_checklist_slot card's caveat:
              that one changes every future claim and not this one, this
              one changes this claim and nothing else. Saying which is
              which is the only way a desk can tell them apart. */}
          <div className="mt-1.5 text-sm leading-[1.45] text-ink-faint">
            Only this claim. The checklist other claims are opened against
            doesn&apos;t change, and the slot is added as optional, so it
            won&apos;t show as a gap.
          </div>
        </>
      ) : null}

      {proposal.kind === "add_checklist_slot" ? (
        <>
          <div className="font-semibold [overflow-wrap:anywhere]">
            Add &ldquo;{String(proposal.input.document_type ?? "")}&rdquo; to
            this checklist
          </div>
          {/* The sentence that stops this card reading as a fix for the
              file that prompted it. Rules are snapshotted at claim
              creation and never reach back (adr 0001), so the claim in
              hand is unchanged and the document still needs a home. */}
          <div className="mt-1 text-sm leading-[1.45] text-ink-faint">
            Applies to claims opened from now on, for this insurer and
            procedure. It won&apos;t open a slot on the claim this came from —
            that claim&apos;s checklist was fixed when it was created.
          </div>
        </>
      ) : null}

      {proposal.kind === "confirm_query_deadline" ? (
        <>
          <div className="font-semibold">
            {proposal.input.deadline === null
              ? "Record that this query has no reply deadline"
              : "Confirm this query's reply deadline"}
          </div>
          {typeof proposal.input.deadline === "string" ? (
            <div className="mt-0.5 font-mono text-sm tabular-nums text-ink-soft">
              {new Date(proposal.input.deadline).toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </div>
          ) : null}
        </>
      ) : null}

      {proposal.kind === "open_appeal" ? (
        <>
          <div className="font-semibold">
            Contest{" "}
            {rows.length === 1
              ? "this deduction"
              : `these ${rows.length} deductions`}
            {total !== null ? ` · ${formatAmount(String(total))}` : ""}
          </div>

          {/* Every row the desk is approving, with the figure that
              makes it worth approving. Read from the appeal worklist,
              not from the proposal: the model chose which ones, and
              the server says what they are worth. */}
          {worklist.isPending ? (
            <div className="mt-1 text-sm text-ink-faint">
              Reading the appeal worklist…
            </div>
          ) : rows.length === 0 ? (
            <div className="mt-1 text-sm leading-[1.45] text-ink-faint">
              {/* Either the ids were wrong or somebody got there first.
                  Saying nothing and showing a button would be worse. */}
              None of these are still uncontested — nothing left to open.
            </div>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="text-ink-soft [overflow-wrap:anywhere]">
                    {row.claimReference} · {row.patientName} ·{" "}
                    {DEDUCTION_REASON_LABEL[row.reason]}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-ink">
                    {formatAmount(row.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* What approving does and does not do. ADR 0013's lifecycle
              stops at CONTESTED; the insurer answering is a separate
              act somebody has to come back and record. */}
          <div className="mt-1.5 text-sm leading-[1.45] text-ink-faint">
            Marks each one as contested so it shows on the appeal worklist.
            Nothing is sent to the insurer — the argument is yours to make, and
            the outcome is recorded when they answer.
          </div>

          {/* The batch is not all-or-nothing, so the result says which
              half happened rather than a flat "Done". */}
          {outcome ? (
            <div className="mt-1.5 text-sm leading-[1.45] text-ink-soft">
              {outcome}
            </div>
          ) : null}
        </>
      ) : null}

      {approve.isError ? (
        <div className="mt-2 text-sm font-medium text-critical">
          Couldn&apos;t do that — {(approve.error as Error).message}
        </div>
      ) : null}

      {done ? null : (
        <div className="mt-2.5 flex gap-1.5">
          <Button
            type="button"
            size="sm"
            disabled={
              approve.isPending ||
              (proposal.kind === "file_document" && !slot) ||
              // Nothing uncontested left, so the button would do
              // nothing and report success for it.
              (proposal.kind === "open_appeal" &&
                (worklist.isPending || rows.length === 0))
            }
            onClick={() =>
              approve.mutate({
                kind: proposal.kind,
                input: payload(),
                // Without these the server has nothing to record the
                // approval against, and the card comes back offering
                // itself again next week.
                conversationId,
                proposalId: proposal.id,
              })
            }
          >
            {approve.isPending ? "Working…" : approveLabel(proposal.kind)}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setDismissed(true)}
          >
            Not now
          </Button>
        </div>
      )}
    </div>
  );
}

/** The button says what happens, not "confirm" — a desk reads the verb, not the dialog. */
function approveLabel(kind: Proposal["kind"]): string {
  switch (kind) {
    case "file_document":
      return "File it";
    case "log_query":
      return "Log it";
    case "mark_query_replied":
      return "Mark replied";
    case "confirm_query_deadline":
      return "Confirm";
    case "add_checklist_slot":
      return "Add the slot";
    case "file_as_new_slot":
      return "Add slot and file";
    case "open_appeal":
      return "Open the appeals";
  }
}
