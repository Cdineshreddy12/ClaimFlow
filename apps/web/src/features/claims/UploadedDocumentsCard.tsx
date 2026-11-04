import { useRef, useState } from "react";
import { FileIcon } from "../../components/icons";
import {
  displayFileName,
  useConfirmDocument,
  useDiscardDocument,
  useDocuments,
  useUploadDocument,
} from "../documents/api";
import type { ClaimDocument } from "../documents/types";
import type { Claim } from "./types";

function UploadRow({ doc, claim }: { doc: ClaimDocument; claim: Claim }) {
  const [slot, setSlot] = useState(
    doc.checklistSlot ?? claim.checklistSnapshot[0]?.documentType ?? "",
  );
  const confirmDoc = useConfirmDocument(claim.id);
  const discardDoc = useDiscardDocument(claim.id);

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
        <span className="upload-conf">Needs confirm</span>
      </div>
      <div className="upload-confirm-row">
        <select value={slot} onChange={(e) => setSlot(e.target.value)}>
          {claim.checklistSnapshot.map((item) => (
            <option key={item.documentType} value={item.documentType}>
              {item.documentType}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={!slot || confirmDoc.isPending}
          onClick={() =>
            confirmDoc.mutate({ documentId: doc.id, checklistSlot: slot })
          }
        >
          Confirm
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={discardDoc.isPending}
          onClick={() => discardDoc.mutate(doc.id)}
        >
          Discard
        </button>
      </div>
    </div>
  );
}

export function UploadedDocumentsCard({ claim }: { claim: Claim }) {
  const { data: documents } = useDocuments(claim.id);
  const uploadDoc = useUploadDocument(claim.id);
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
            <UploadRow key={doc.id} doc={doc} claim={claim} />
          ))}
        </div>
      )}
    </div>
  );
}
