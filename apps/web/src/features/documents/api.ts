import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
export function useUploadDocument(claimId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const { uploadUrl, key } = await api.post<{
        uploadUrl: string;
        key: string;
      }>(`/claims/${claimId}/documents/upload-url`, {
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
      });

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) throw new Error("upload to storage failed");

      return api.post<ClaimDocument>(`/claims/${claimId}/documents`, {
        key,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["claims", claimId, "documents"],
      });
    },
  });
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
