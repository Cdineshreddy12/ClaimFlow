import { useState } from "react";
import {
  CLASSIFIER_LABEL,
  LOW_CONFIDENCE_THRESHOLD,
} from "@claimflow/contracts";
import { FileIcon } from "@/components/icons";
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

  if (doc.confirmedAt) {
    return (
      <div className="upload-row">
        <div className="upload-top">
          <div className="upload-file">
            <FileIcon />
            {displayFileName(doc.fileUrl)}
          </div>
        </div>
        <div className="upload-slot">
          Sorted to · <b>{doc.checklistSlot}</b>
        </div>
      </div>
    );
  }

  return (
    <div className="upload-row is-flagged">
      <div className="upload-top">
        <div className="upload-file">
          <FileIcon />
          {displayFileName(doc.fileUrl)}
        </div>
        {suggestion && confidence !== null ? (
          <span className="upload-conf">
            {Math.round(confidence * 100)}% match
          </span>
        ) : (
          <span className="upload-conf">Needs a slot</span>
        )}
      </div>

      {suggestion ? (
        <div className="upload-slot">
          Suggested · <b>{suggestion}</b>
        </div>
      ) : null}

      {doc.classificationReason ? (
        // The evidence, verbatim. A suggestion a human can't check is a
        // suggestion they either rubber-stamp or ignore.
        <div className="upload-snippet">{doc.classificationReason}</div>
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

      <div className="upload-confirm-row">
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
          variant="ghost"
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
