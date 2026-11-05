import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import type {
  ExtractionResult,
  PreauthFieldRow,
  PreauthFieldsResponse,
} from "./types";

export function usePreauthFields(claimId: string) {
  return useQuery({
    queryKey: ["claims", claimId, "preauth-fields"],
    queryFn: () =>
      api.get<PreauthFieldsResponse>(`/claims/${claimId}/preauth-fields`),
    enabled: Boolean(claimId),
  });
}

/**
 * Confirming a field can change the claim itself — the admission date
 * and the total both write back onto it — so the claim is invalidated
 * alongside the field list rather than just the latter.
 */
function usePreauthMutation<TArgs, TResult>(
  claimId: string,
  mutationFn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["claims", claimId, "preauth-fields"],
      });
      queryClient.invalidateQueries({ queryKey: ["claims", claimId] });
    },
  });
}

export function useExtractPreauthFields(claimId: string) {
  return usePreauthMutation(claimId, () =>
    api.post<ExtractionResult>(`/claims/${claimId}/preauth-fields/extract`),
  );
}

export function useConfirmPreauthField(claimId: string) {
  return usePreauthMutation(
    claimId,
    ({ fieldKey, value }: { fieldKey: string; value: string }) =>
      api.patch<PreauthFieldRow>(
        `/claims/${claimId}/preauth-fields/${fieldKey}`,
        { value },
      ),
  );
}

export function useClearPreauthField(claimId: string) {
  return usePreauthMutation(claimId, (fieldKey: string) =>
    api.delete(`/claims/${claimId}/preauth-fields/${fieldKey}`),
  );
}

/**
 * Uploads a file for a pre-auth field.
 *
 * Reuses the claim's existing presign endpoint — the bytes go straight
 * to S3, same as a checklist document — but deliberately does NOT
 * register it as a claim document. A file answering a form field isn't
 * a checklist item, and filing it as one would make the gap view count
 * it toward documents the insurer asked for.
 *
 * Returns the value shape the field stores, serialised.
 */
export async function uploadFieldFile(
  claimId: string,
  file: File,
): Promise<string> {
  const contentType = file.type || "application/octet-stream";
  const { uploadUrl, key } = await api.post<{
    uploadUrl: string;
    key: string;
  }>(`/claims/${claimId}/documents/upload-url`, {
    fileName: file.name,
    contentType,
  });

  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  });
  if (!res.ok) throw new Error("Couldn't upload that file.");

  return JSON.stringify({
    s3Key: key,
    fileName: file.name,
    mimeType: contentType,
    sizeBytes: file.size,
  });
}
