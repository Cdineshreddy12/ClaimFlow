import { useRef } from "react";
import {
  useConfirmDocument,
  useDiscardDocument,
  useDocuments,
  useReclassifyDocument,
  useUploadDocuments,
} from "../documents/api";
import type { Claim } from "./types";
import { UploadRow } from "./UploadRow";
import { Button } from "../../components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export function UploadedDocumentsCard({ claim }: { claim: Claim }) {
  const { data: documents } = useDocuments(claim.id);
  const uploadDoc = useUploadDocuments(claim.id);
  // Survives the mutation settling, so the list of what to fix stays
  // on screen after the batch finishes rather than flashing past.
  const rejected = uploadDoc.data?.rejected ?? [];
  const confirmDoc = useConfirmDocument(claim.id);
  const discardDoc = useDiscardDocument(claim.id);
  const reread = useReclassifyDocument(claim.id);
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Uploaded Documents</CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploadDoc.isPending}
          onClick={() => fileInput.current?.click()}
        >
          {/* The count, not a spinner: a stack of eight takes long
              enough that "Uploading…" stops being reassuring and
              starts looking stuck. */}
          {uploadDoc.progress
            ? `Uploading ${uploadDoc.progress.done + 1} of ${uploadDoc.progress.total}…`
            : "Upload"}
        </Button>
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length > 0) uploadDoc.mutate(files);
            e.target.value = "";
          }}
        />
      </CardHeader>

      {/* Named, per file. "Upload failed — try again" was wrong twice
          over on a batch: it did not say which of the eight failed, and
          every way this fails is deterministic, so trying again
          reproduces it. The reason is already on the error the hook
          throws — a size, a type, or storage refusing it. */}
      {rejected.length > 0 ? (
        <div className="mb-3 flex flex-col gap-1 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base text-critical">
          {rejected.map((r) => (
            <div key={r.fileName}>
              <span className="font-medium">{r.fileName}</span> — {r.reason}
            </div>
          ))}
        </div>
      ) : null}

      {uploadDoc.isError ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
          {uploadDoc.error instanceof Error && uploadDoc.error.message
            ? uploadDoc.error.message
            : "Those files couldn't be uploaded."}
        </div>
      ) : null}

      {!documents || documents.length === 0 ? (
        <p className="px-1 py-2.5 text-base text-ink-faint">
          Nothing uploaded yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {documents.map((doc) => (
            <UploadRow
              key={doc.id}
              doc={doc}
              claim={claim}
              isBusy={
                confirmDoc.isPending || discardDoc.isPending || reread.isPending
              }
              onConfirm={(checklistSlot) =>
                confirmDoc.mutate({ documentId: doc.id, checklistSlot })
              }
              onDiscard={() => discardDoc.mutate(doc.id)}
              onReread={() => reread.mutate(doc.id)}
              // Scoped to the row that was actually re-read — one
              // mutation serves the whole list, and an error shown
              // on every row would blame files nobody touched.
              rereadError={
                reread.isError && reread.variables === doc.id
                  ? reread.error instanceof Error
                    ? reread.error.message
                    : "Couldn't read this document."
                  : null
              }
            />
          ))}
        </div>
      )}
    </Card>
  );
}
