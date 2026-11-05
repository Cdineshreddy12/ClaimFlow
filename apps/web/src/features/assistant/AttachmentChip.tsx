import { useState } from "react";
import { FilePreview } from "@/components/FilePreview";
import type { AssistantAttachment } from "./types";

/**
 * One file, and what is known about it so far.
 *
 * The chip used to say `name · claim not identified` for everything,
 * including files that had matched a claim at 97% — and it said it
 * while the upload was still in flight, which made "not identified"
 * look like a verdict rather than a thing that hadn't happened yet.
 * Each state now looks different from the others:
 *
 * - **uploading** — a bar, because bytes are moving and the desk should
 *   see that rather than wonder
 * - **reading** — bytes landed, OCR and the recogniser are working
 * - **matched** — the claim it found, and how sure
 * - **unmatched** — genuinely nothing on the page tied it to a claim
 */

export type ChipState = "uploading" | "reading" | "done" | "failed";

export interface StagedFile {
  key: string;
  fileName: string;
  state: ChipState;
  /** 0–1 while uploading. */
  progress?: number | undefined;
  attachment?: AssistantAttachment | undefined;
  error?: string | undefined;
}

export function AttachmentChip({
  file,
  onRemove,
}: {
  file: StagedFile;
  onRemove?: () => void;
}) {
  const [previewing, setPreviewing] = useState(false);
  const attachment = file.attachment;
  const claim = attachment?.suggestedClaim;
  const confidence = attachment?.claimConfidence
    ? Math.round(Number(attachment.claimConfidence) * 100)
    : null;

  return (
    <>
      {/* Opens over the panel rather than in a new tab: the filing
          decision needs the page and what the assistant said about it
          at the same time. */}
      {previewing && attachment ? (
        <FilePreview
          target={{
            fileName: attachment.fileName,
            contentType: attachment.contentType,
            downloadPath: `/assistant/attachments/${attachment.id}/download-url`,
          }}
          onClose={() => setPreviewing(false)}
        />
      ) : null}
      <div className="flex min-w-0 max-w-full items-start gap-2 rounded-md border border-line bg-surface-raised px-2.5 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {attachment ? (
              <button
                type="button"
                onClick={() => setPreviewing(true)}
                title="Look at this file"
                className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-sm font-medium text-accent-ink underline decoration-dotted underline-offset-2"
              >
                {file.fileName}
              </button>
            ) : (
              <span className="min-w-0 truncate text-sm font-medium text-ink">
                {file.fileName}
              </span>
            )}
          </div>

          {file.state === "uploading" ? (
            <div className="mt-1 flex items-center gap-1.5">
              <div className="h-1 w-20 overflow-hidden rounded-full bg-hover">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-150"
                  style={{
                    width: `${Math.round((file.progress ?? 0) * 100)}%`,
                  }}
                />
              </div>
              <span className="text-2xs tabular-nums text-ink-faint">
                {Math.round((file.progress ?? 0) * 100)}%
              </span>
            </div>
          ) : null}

          {file.state === "reading" ? (
            <div className="mt-0.5 text-2xs text-ink-faint">
              Reading the page…
            </div>
          ) : null}

          {file.state === "failed" ? (
            <div className="mt-0.5 text-2xs font-medium text-critical">
              {file.error ?? "Upload failed"}
            </div>
          ) : null}

          {/* Loudest thing on the chip when it applies: the desk is
            about to be asked to approve filing something they have
            already filed. */}
          {file.state === "done" && attachment?.duplicateOf ? (
            <div className="mt-0.5 text-2xs font-semibold text-pending">
              {attachment.duplicateOf.kind === "same_file"
                ? `Already filed on ${attachment.duplicateOf.claimReference ?? "a claim"}`
                : `${attachment.duplicateOf.claimReference ?? "That claim"} already has a file with this name`}
              {attachment.duplicateOf.slot
                ? ` · ${attachment.duplicateOf.slot}`
                : ""}
            </div>
          ) : null}

          {file.state === "done" ? (
            claim ? (
              <div className="mt-0.5 text-2xs text-ink-faint">
                <span className="font-semibold text-approved">
                  {claim.reference ?? "Matched"}
                </span>{" "}
                · {claim.patientName}
                {confidence !== null ? ` · ${confidence}%` : ""}
                {attachment?.suggestedSlot
                  ? ` · ${attachment.suggestedSlot}`
                  : ""}
              </div>
            ) : (
              <div className="mt-0.5 text-2xs text-pending">
                No claim matched — say which one
              </div>
            )
          ) : null}
        </div>

        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${file.fileName}`}
            className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-md leading-none text-ink-faint hover:text-ink"
          >
            ×
          </button>
        ) : null}
      </div>
    </>
  );
}
