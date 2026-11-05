import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";

/**
 * Looks at a scan without leaving the page.
 *
 * Opening a pre-signed URL in a new tab worked, and cost the desk the
 * thing they were in the middle of: a filing decision is made by
 * looking at the page *and* at what the panel says about it, and a
 * browser tab can only show one of those.
 *
 * The URL is still minted on open rather than on render — pre-signed
 * links are short-lived, and most file names on a screen are never
 * clicked.
 */

export interface PreviewTarget {
  fileName: string;
  /** Where to ask for the signed URL. */
  downloadPath: string;
  contentType?: string | undefined;
}

/** Content type if we were told one, otherwise what the name suggests. */
function kindOf(target: PreviewTarget): "image" | "pdf" | "other" {
  const type = target.contentType ?? "";
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf") return "pdf";
  const ext = target.fileName.toLowerCase().split(".").pop() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "tiff", "tif"].includes(ext)) {
    return "image";
  }
  if (ext === "pdf") return "pdf";
  return "other";
}

export function FilePreview({
  target,
  onClose,
}: {
  /** Null closes it. */
  target: PreviewTarget | null;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      setUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setUrl(null);
    setError(null);
    api
      .get<{ downloadUrl: string }>(target.downloadPath)
      .then(({ downloadUrl }) => {
        // The dialog can be closed while the URL is still coming back;
        // setting state then would reopen it holding a stale file.
        if (!cancelled) setUrl(downloadUrl);
      })
      .catch(() => {
        if (!cancelled) setError("That file isn't there any more.");
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  if (!target) return null;
  const kind = kindOf(target);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[min(1100px,calc(100vw-2rem))] p-0">
        <div className="px-5 pt-5">
          <DialogHeader title={target.fileName} description="Uploaded scan" />
        </div>

        <div className="flex min-h-[320px] items-center justify-center bg-hover/40 px-5 py-4">
          {error ? (
            <p className="text-base font-medium text-critical">{error}</p>
          ) : !url ? (
            <p className="text-base text-ink-faint">Loading…</p>
          ) : kind === "image" ? (
            <img
              src={url}
              alt={target.fileName}
              className="max-h-[70vh] max-w-full object-contain"
            />
          ) : kind === "pdf" ? (
            <iframe
              src={url}
              title={target.fileName}
              className="h-[70vh] w-full border-0 bg-surface"
            />
          ) : (
            // A .txt or anything else the browser won't inline: say so
            // rather than showing an empty frame.
            <p className="text-base text-ink-faint">
              This file can&apos;t be shown here — open it to read it.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          {/* Still available: a new tab is where you zoom, rotate and
              print, which a dialog has no business reimplementing. */}
          {url ? (
            <Button asChild variant="outline" size="sm">
              <a href={url} target="_blank" rel="noopener noreferrer">
                Open in a new tab
              </a>
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
