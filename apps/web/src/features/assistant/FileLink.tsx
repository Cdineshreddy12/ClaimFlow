import { useState } from "react";
import { FilePreview } from "@/components/FilePreview";

/**
 * A filename in the assistant's prose that opens the actual file.
 *
 * The assistant lists documents and attachments by name constantly —
 * in tables, in bullets, mid-sentence — and every one of those was a
 * dead string. The reader's next question is always "which one is
 * that?", and the answer was to go and find it on the claim.
 *
 * Addressed by two private schemes the model is told to emit:
 *
 *   [scan_0017.jpg](document:<claimId>/<documentId>)
 *   [IMG_0423.jpg](attachment:<attachmentId>)
 *
 * Schemes rather than real URLs because a download link is pre-signed
 * and short-lived: minting one per filename on every tool call would
 * spend them on the many that are never clicked, and they would be
 * stale by the time anyone did. This resolves on click instead.
 */

export type FileRef =
  | { kind: "document"; claimId: string; documentId: string }
  | { kind: "attachment"; attachmentId: string };

/** Returns null for anything that isn't one of ours, which stays an ordinary link. */
export function parseFileRef(href: string | undefined): FileRef | null {
  if (!href) return null;
  if (href.startsWith("attachment:")) {
    const id = href.slice("attachment:".length);
    return id ? { kind: "attachment", attachmentId: id } : null;
  }
  if (href.startsWith("document:")) {
    const [claimId, documentId] = href.slice("document:".length).split("/");
    return claimId && documentId
      ? { kind: "document", claimId, documentId }
      : null;
  }
  return null;
}

function urlFor(ref: FileRef): string {
  return ref.kind === "attachment"
    ? `/assistant/attachments/${ref.attachmentId}/download-url`
    : `/claims/${ref.claimId}/documents/${ref.documentId}/download-url`;
}

export function FileLink({
  reference,
  children,
}: {
  reference: FileRef;
  children: React.ReactNode;
}) {
  const [previewing, setPreviewing] = useState(false);

  // The text of the link is the filename the assistant wrote, which is
  // the only name this component has for the file.
  const fileName = typeof children === "string" ? children : "Attached file";

  return (
    <>
      {previewing ? (
        <FilePreview
          target={{ fileName, downloadPath: urlFor(reference) }}
          onClose={() => setPreviewing(false)}
        />
      ) : null}
      <button
        type="button"
        onClick={() => setPreviewing(true)}
        title="Look at this file"
        className="cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] text-[length:inherit] text-accent-ink underline decoration-dotted underline-offset-2"
      >
        {children}
      </button>
    </>
  );
}
