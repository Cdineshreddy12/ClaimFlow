import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import {
  CLASSIFIER_LABEL,
  LOW_CONFIDENCE_THRESHOLD,
} from "@claimflow/contracts";
import { FileIcon } from "@/components/icons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FilePreview } from "@/components/FilePreview";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { displayFileName } from "../documents/api";
import type { ClaimDocument } from "../documents/types";
import type { Claim } from "./types";

/**
 * Whether anything vouches for the slot the human has selected.
 *
 * The confirm step used to be silent: any file went into any slot and
 * the row said nothing about whether the classifier agreed, disagreed,
 * or had declined to answer. A company logo went into "Pre-authorization
 * form" that way — the classifier had refused it (no slot, confidence 0)
 * and the refusal never reached the person clicking Confirm.
 *
 * It stays a note, never a block. The human overriding the machine is
 * the design (docs/adr/0005); the machine saying nothing while they do
 * it is the bug.
 */
type Vouching =
  | { kind: "agrees" }
  /** Something read it and said a different slot. */
  | { kind: "differs"; read: string }
  /** A classifier ran and declined to name a slot. */
  | { kind: "refused" }
  /** Nothing read it — no key configured, or an unreadable file type. */
  | { kind: "unread" };

function vouchingFor(
  selected: string,
  suggestion: string | null,
  classifiedBy: string | null,
): Vouching {
  if (suggestion) {
    return selected === suggestion
      ? { kind: "agrees" }
      : { kind: "differs", read: suggestion };
  }
  return classifiedBy ? { kind: "refused" } : { kind: "unread" };
}

/**
 * Slots this claim gained after the document was read.
 *
 * A classification answers "which of these slots", and the list moves
 * underneath it. A cost estimate was read against six slots, correctly
 * refused them all, and the next day the claim gained a "Cost estimate"
 * slot — so the stored refusal went on describing a checklist that no
 * longer existed, with the right slot sitting in the dropdown below it.
 *
 * Compares against `classifiedAt`, never `createdAt`: a re-read has to
 * clear this, and the upload time doesn't move when one happens.
 * Original slots carry no `addedAt` at all, so a claim whose checklist
 * never changed is never stale.
 */
function slotsAddedSince(claim: Claim, readAt: string): string[] {
  return claim.checklistSnapshot
    .filter((item) => item.addedAt && item.addedAt > readAt)
    .map((item) => item.documentType);
}

/**
 * One uploaded document awaiting a human decision.
 *
 * The classifier's suggestion is pre-selected but never applied: nothing
 * counts toward the gap view until someone clicks Confirm (docs/adr/0005).
 * The suggestion always shows who made it and why, so a desk exec can
 * tell a filename match from something that actually read the page.
 */
export function UploadRow({
  doc,
  claim,
  onConfirm,
  onDiscard,
  onReread,
  rereadError,
  isBusy,
}: {
  doc: ClaimDocument;
  claim: Claim;
  onConfirm: (slot: string) => void;
  onDiscard: () => void;
  /** Absent where re-reading isn't wired up; the button then stays disabled. */
  onReread?: (() => void) | undefined;
  /** What went wrong on the last re-read of THIS row, if anything. */
  rereadError?: string | null | undefined;
  isBusy: boolean;
}) {
  const suggestion = doc.aiClassifiedType;
  const confidence = doc.confidence === null ? null : Number(doc.confidence);
  const isLowConfidence =
    confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD;

  // Start on the suggestion so the common case is one click.
  const [slot, setSlot] = useState(doc.checklistSlot ?? suggestion ?? "");
  const vouching = vouchingFor(slot, suggestion, doc.classifiedBy);

  // Against when it was READ, not when it was uploaded. Those were the
  // same number until re-reading existed, and using createdAt meant the
  // warning survived the very action that resolved it.
  const newSlots = doc.classifiedAt
    ? slotsAddedSince(claim, doc.classifiedAt)
    : [];
  const isStale = newSlots.length > 0;

  // Offered whenever nothing usable is on record — a document nothing
  // ever read is the one that most needs asking, and hanging the button
  // off the stale notice alone left it with no way to try.
  const canReread = isStale || !suggestion;
  const [previewing, setPreviewing] = useState(false);
  // Discarding deletes the row and the file in S3. The button sits a
  // mouse-width from Confirm and there is no undo.
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const fileName = displayFileName(doc.fileUrl);

  const drag = useDraggable({
    id: doc.id,
    // Read back on drop: the filename for the overlay, and the slot it
    // already sits in so dropping it there again is a no-op.
    data: { fileName, slot: doc.checklistSlot },
  });

  /**
   * A grip, rather than making the whole row draggable.
   *
   * The row already carries a filename that opens the file, a slot
   * picker and three buttons; a drag listener over all of that eats
   * their clicks and their keyboard focus. A handle says where to take
   * hold and leaves everything else alone — and it is what dnd-kit's
   * KeyboardSensor binds to, so the gesture has a keyboard equivalent
   * instead of being pointer-only.
   */
  const grip = (
    <button
      type="button"
      ref={drag.setNodeRef}
      {...drag.listeners}
      {...drag.attributes}
      title={`Drag ${fileName} onto a checklist slot`}
      aria-label={`Move ${fileName} to a checklist slot`}
      className="shrink-0 cursor-grab touch-none border-0 bg-transparent px-1 text-ink-faint hover:text-ink active:cursor-grabbing"
    >
      <span aria-hidden className="text-md leading-none">
        ⠿
      </span>
    </button>
  );

  /**
   * The filename, as a way into the page itself.
   *
   * It mattered most on the unconfirmed row: the desk is asked to pick
   * a slot for a document they could not see, with only the
   * classifier's one-line reason to go on. Agreeing with a sentence
   * about a page is not the same as reading it.
   */
  const name = (
    <button
      type="button"
      onClick={() => setPreviewing(true)}
      title="Look at this document"
      className="flex min-w-0 cursor-pointer items-center gap-[7px] overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 text-left font-[inherit] text-sm font-semibold text-accent-ink underline decoration-dotted underline-offset-2 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-ink-faint"
    >
      <FileIcon />
      {fileName}
    </button>
  );

  // One button, several homes: it belongs to whichever notice is
  // showing rather than to one of them.
  const rereadButton = canReread ? (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={isBusy || onReread === undefined}
      onClick={() => onReread?.()}
    >
      {isBusy ? "Reading…" : "Read again"}
    </Button>
  ) : null;

  const discardConfirm = (
    <ConfirmDialog
      open={confirmingDiscard}
      onOpenChange={setConfirmingDiscard}
      title={`Discard ${fileName}?`}
      description="The file is deleted from storage as well as from this claim. If it was the only copy of a scan, it is gone."
      confirmLabel="Discard the file"
      busy={isBusy}
      onConfirm={() => {
        setConfirmingDiscard(false);
        onDiscard();
      }}
    />
  );

  const preview = previewing ? (
    <FilePreview
      target={{
        fileName,
        downloadPath: `/claims/${claim.id}/documents/${doc.id}/download-url`,
      }}
      onClose={() => setPreviewing(false)}
    />
  ) : null;

  if (doc.confirmedAt) {
    const filed = vouchingFor(
      doc.checklistSlot ?? "",
      suggestion,
      doc.classifiedBy,
    );
    return (
      <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-raised px-[13px] py-[11px]">
        {preview}
        <div className="flex items-center gap-1">
          {grip}
          {name}
        </div>
        <div className="text-base [&_b]:font-semibold">
          Sorted to · <b>{doc.checklistSlot}</b>
        </div>
        {/* Kept on the record rather than only at the moment of the
            click. Six weeks later, when a TPA queries this document,
            "nothing identified it and someone filed it anyway" is the
            first thing worth knowing about it. Quiet, though — it is a
            note on a settled decision, not an alarm. */}
        {filed.kind === "differs" ? (
          <div className="text-sm text-ink-faint">
            Read as <b className="font-semibold">{filed.read}</b> · filed here
            by hand
          </div>
        ) : filed.kind === "refused" ? (
          <div className="text-sm text-ink-faint">
            Nothing identified this document · filed here by hand
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-pending bg-surface-raised px-[13px] py-[11px]">
      {preview}
      {discardConfirm}
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-1">
          {grip}
          {name}
        </div>
        {suggestion && confidence !== null ? (
          <span className="shrink-0 text-sm text-ink-faint">
            {Math.round(confidence * 100)}% match
          </span>
        ) : (
          <span className="shrink-0 text-sm text-ink-faint">Needs a slot</span>
        )}
      </div>

      {suggestion ? (
        <div className="text-base [&_b]:font-semibold">
          Suggested · <b>{suggestion}</b>
        </div>
      ) : null}

      {doc.classificationReason ? (
        // The evidence, verbatim. A suggestion a human can't check is a
        // suggestion they either rubber-stamp or ignore.
        <div className="border-l-2 border-line-strong pl-2 text-sm italic text-ink-faint">
          {doc.classificationReason}
        </div>
      ) : null}

      {/* Only meaningful alongside a suggestion — "low confidence" with
          nothing suggested is noise, and naming the classifier when it
          produced nothing just invites distrust of the ones it got right. */}
      {doc.classifiedBy && suggestion ? (
        <div
          className={
            isLowConfidence
              ? "text-xs font-semibold text-pending"
              : "text-xs text-ink-faint"
          }
        >
          {CLASSIFIER_LABEL[doc.classifiedBy]}
          {isLowConfidence ? " · low confidence, worth checking" : ""}
        </div>
      ) : null}

      {/* Takes precedence over the vouching note below, which would
          otherwise lend present-tense authority to a judgement made
          against a checklist that has since changed — the stored
          refusal is answering a question nobody is asking any more. */}
      {isStale ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-line-strong bg-hover/50 px-2.5 py-2 text-sm leading-snug text-ink-soft [&_b]:font-semibold [&_b]:text-ink">
          <span>
            This was read before the claim had{" "}
            {newSlots.map((name, i) => (
              <span key={name}>
                {i > 0 ? (i === newSlots.length - 1 ? " and " : ", ") : ""}
                <b>{name}</b>
              </span>
            ))}
            .
          </span>
          {rereadButton}
        </div>
      ) : vouching.kind === "differs" || vouching.kind === "refused" ? (
        <div className="flex gap-2 rounded-sm border border-pending bg-pending-bg px-2.5 py-2 text-sm leading-snug text-ink [&_b]:font-semibold">
          {/* Named only once a slot is actually chosen. Before that
              there is no filing to warn about — naming the empty one
              produced "filing it as ." on screen. */}
          <span>
            {vouching.kind === "differs" ? (
              <>
                This was read as <b>{vouching.read}</b>. Filing it as{" "}
                <b>{slot}</b> goes against that — open it and check.
              </>
            ) : slot ? (
              <>
                Nothing could identify this document, so no slot is vouched for.
                Open it and check before filing it as <b>{slot}</b>.
              </>
            ) : (
              <>
                Nothing could identify this document. Open it and check before
                picking a slot — no suggestion here is standing behind the
                choice.
              </>
            )}
          </span>
          {rereadButton}
        </div>
      ) : vouching.kind === "unread" ? (
        // Milder: nothing was wrong, nothing was read either. Says so
        // rather than letting silence imply a machine agreed — and
        // offers the read that never happened.
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-faint">
          <span>
            This document wasn&apos;t read automatically — the slot is your
            call.
          </span>
          {rereadButton}
        </div>
      ) : null}

      {/* A re-read that failed has to say so. The endpoint 422s rather
          than returning the unchanged row as success, because a button
          that silently does nothing is the thing being fixed. */}
      {rereadError ? (
        <div className="rounded-sm border border-critical bg-critical-bg px-2.5 py-2 text-sm font-medium text-critical">
          {rereadError}
        </div>
      ) : null}

      <div className="flex items-center gap-2 [&_select]:flex-1 [&_select]:rounded-sm [&_select]:border [&_select]:border-line-strong [&_select]:bg-surface-raised [&_select]:px-2 [&_select]:py-1.5 [&_select]:text-sm [&_select]:text-ink">
        <Select value={slot || undefined} onValueChange={setSlot}>
          <SelectTrigger aria-label="Checklist slot">
            <SelectValue placeholder="Pick a slot…" />
          </SelectTrigger>
          <SelectContent>
            {claim.checklistSnapshot.map((item) => (
              <SelectItem key={item.documentType} value={item.documentType}>
                {item.documentType}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* "Confirm anyway" rather than a disabled button: a desk that
            has opened the page and knows what it is must be able to
            file it, and the classifier is wrong often enough that
            blocking would be the worse failure (docs/adr/0005). The
            word is the whole intervention — it makes the override an
            act rather than the same click as agreeing. */}
        <Button
          type="button"
          size="sm"
          disabled={!slot || isBusy}
          onClick={() => onConfirm(slot)}
        >
          {slot && (vouching.kind === "differs" || vouching.kind === "refused")
            ? "Confirm anyway"
            : "Confirm"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isBusy}
          onClick={() => setConfirmingDiscard(true)}
        >
          Discard
        </Button>
      </div>
    </div>
  );
}
