import { useRef } from "react";
import {
  useConfirmDocument,
  useDiscardDocument,
  useDocuments,
  useUploadDocument,
} from "../documents/api";
import type { Claim } from "./types";
import { UploadRow } from "./UploadRow";

export function UploadedDocumentsCard({ claim }: { claim: Claim }) {
  const { data: documents } = useDocuments(claim.id);
  const uploadDoc = useUploadDocument(claim.id);
  const confirmDoc = useConfirmDocument(claim.id);
  const discardDoc = useDiscardDocument(claim.id);
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="card card-pad">
      <div className="card-head">
        <h2 className="label-eyebrow">Uploaded Documents</h2>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={uploadDoc.isPending}
          onClick={() => fileInput.current?.click()}
        >
          {uploadDoc.isPending ? "Uploading…" : "Upload"}
        </button>
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
      </div>

      {uploadDoc.isError ? (
        <div className="inline-error">Upload failed — try again.</div>
      ) : null}

      {!documents || documents.length === 0 ? (
        <p className="empty-state">Nothing uploaded yet.</p>
      ) : (
        <div className="upload-list">
          {documents.map((doc) => (
            <UploadRow
              key={doc.id}
              doc={doc}
              claim={claim}
              isBusy={confirmDoc.isPending || discardDoc.isPending}
              onConfirm={(checklistSlot) =>
                confirmDoc.mutate({ documentId: doc.id, checklistSlot })
              }
              onDiscard={() => discardDoc.mutate(doc.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
