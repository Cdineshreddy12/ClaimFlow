import { useRef } from "react";
import {
  useConfirmDocument,
  useDiscardDocument,
  useDocuments,
  useReclassifyDocument,
  useUploadDocument,
} from "../documents/api";
import type { Claim } from "./types";
import { UploadRow } from "./UploadRow";
import { Button } from "../../components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export function UploadedDocumentsCard({ claim }: { claim: Claim }) {
  const { data: documents } = useDocuments(claim.id);
  const uploadDoc = useUploadDocument(claim.id);
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
          {uploadDoc.isPending ? "Uploading…" : "Upload"}
        </Button>
        <input
          ref={fileInput}
          type="file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadDoc.mutate(file);
            e.target.value = "";
          }}
        />
      </CardHeader>

      {uploadDoc.isError ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
          Upload failed — try again.
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
