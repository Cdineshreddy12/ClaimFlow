import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { uploadRejection } from "@claimflow/contracts";
import { api } from "../../lib/api-client";
import type { ClaimDocument } from "./types";

/** Strips the uuid-prefix buildObjectKey adds server-side, back to the name the user actually uploaded. */
export function displayFileName(key: string): string {
  const base = key.split("/").pop() ?? key;
  return base.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/,
    "",
  );
}

export function useDocuments(claimId: string) {
  return useQuery({
    queryKey: ["claims", claimId, "documents"],
    queryFn: () => api.get<ClaimDocument[]>(`/claims/${claimId}/documents`),
    enabled: Boolean(claimId),
  });
}

/** Full upload flow: request a pre-signed URL, PUT the file straight to S3, then register the row. The API never sees the bytes — see docs/adr/0003. */
async function uploadOne(claimId: string, file: File) {
  // Refused here as well as on the server, so a 90MB video fails
  // in front of the person who chose it rather than after they
  // have waited for it to upload.
  const rejection = uploadRejection(file);
  if (rejection) throw new Error(rejection);

  const { uploadUrl, key } = await api.post<{
    uploadUrl: string;
    key: string;
  }>(`/claims/${claimId}/documents/upload-url`, {
    fileName: file.name,
    contentType: file.type,
    sizeBytes: file.size,
  });

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putRes.ok) {
    throw new Error("Storage refused the upload. Try that one again.");
  }

  return api.post<ClaimDocument>(`/claims/${claimId}/documents`, {
    key,
    fileName: file.name,
    contentType: file.type,
  });
}

export interface UploadOutcome {
  uploaded: number;
  rejected: { fileName: string; reason: string }[];
}

/**
 * A whole stack of paperwork in one go.
 *
 * A claim file is seven or eight documents and the picker took one at
 * a time, so a desk opened the same dialog eight times to file one
 * admission. The input is `multiple` now and this walks the batch.
 *
 * Sequentially, though, not all at once: every upload the server
 * registers kicks off a classification against Claude, and firing
 * eight of those in parallel is how a desk discovers the rate limit.
 * One at a time is also what makes the count honest — "3 of 8" means
 * three are actually filed.
 *
 * A batch does not fail as a unit. If the fourth file is a video, the
 * other seven are already on the claim and must stay there, so the
 * rejects are collected and returned rather than thrown. The desk sees
 * which ones to fix instead of wondering what landed.
 */
export function useUploadDocuments(claimId: string) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const mutation = useMutation({
    mutationFn: async (files: File[]): Promise<UploadOutcome> => {
      const rejected: UploadOutcome["rejected"] = [];
      let uploaded = 0;

      setProgress({ done: 0, total: files.length });
      for (const file of files) {
        try {
          await uploadOne(claimId, file);
          uploaded++;
          // Refreshed as each one lands, so the list fills in while the
          // rest are still going rather than appearing all at once.
          await queryClient.invalidateQueries({
            queryKey: ["claims", claimId, "documents"],
          });
        } catch (err) {
          rejected.push({
            fileName: file.name,
            reason:
              err instanceof Error && err.message
                ? err.message
                : "That file couldn't be uploaded.",
          });
        }
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      }
      return { uploaded, rejected };
    },
    onSettled: () => setProgress(null),
  });

  return { ...mutation, progress };
}

export function useConfirmDocument(claimId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      documentId,
      checklistSlot,
    }: {
      documentId: string;
      checklistSlot: string;
    }) =>
      api.patch<ClaimDocument>(
        `/claims/${claimId}/documents/${documentId}/confirm`,
        { checklistSlot },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["claims", claimId, "documents"],
      });
      queryClient.invalidateQueries({ queryKey: ["claims", claimId, "gaps"] });
    },
  });
}

/**
 * Reads a document again against the checklist as it stands now.
 *
 * Only invalidates the document list — a re-read changes a suggestion,
 * never a filing, so the gap view cannot have moved.
 */
export function useReclassifyDocument(claimId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) =>
      api.post<ClaimDocument>(
        `/claims/${claimId}/documents/${documentId}/reclassify`,
        {},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["claims", claimId, "documents"],
      });
    },
  });
}

export function useDiscardDocument(claimId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) =>
      api.delete(`/claims/${claimId}/documents/${documentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["claims", claimId, "documents"],
      });
      queryClient.invalidateQueries({ queryKey: ["claims", claimId, "gaps"] });
    },
  });
}
