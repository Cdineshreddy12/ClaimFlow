import { useState } from "react";
import {
  CLASSIFIER_LABEL,
  LOW_CONFIDENCE_THRESHOLD,
} from "@claimflow/contracts";
import { FileIcon } from "@/components/icons";
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
  isBusy,
}: {
  doc: ClaimDocument;
  claim: Claim;
  onConfirm: (slot: string) => void;
  onDiscard: () => void;
  isBusy: boolean;
}) {
  const suggestion = doc.aiClassifiedType;
  const confidence = doc.confidence === null ? null : Number(doc.confidence);
  const isLowConfidence =
    confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD;

  // Start on the suggestion so the common case is one click.
  const [slot, setSlot] = useState(doc.checklistSlot ?? suggestion ?? "");
  const [previewing, setPreviewing] = useState(false);
  const fileName = displayFileName(doc.fileUrl);

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
    return (
      <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-raised px-[13px] py-[11px]">
        {preview}
        <div className="flex items-center justify-between gap-2.5">{name}</div>
        <div className="text-base [&_b]:font-semibold">
          Sorted to · <b>{doc.checklistSlot}</b>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-pending bg-surface-raised px-[13px] py-[11px]">
      {preview}
      <div className="flex items-center justify-between gap-2.5">
        {name}
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
        <div className={isLowConfidence ? "upload-hint" : "upload-conf"}>
          {CLASSIFIER_LABEL[doc.classifiedBy]}
          {isLowConfidence ? " · low confidence, worth checking" : ""}
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
        <Button
          type="button"
          size="sm"
          disabled={!slot || isBusy}
          onClick={() => onConfirm(slot)}
        >
          Confirm
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isBusy}
          onClick={onDiscard}
        >
          Discard
        </Button>
      </div>
    </div>
  );
}
