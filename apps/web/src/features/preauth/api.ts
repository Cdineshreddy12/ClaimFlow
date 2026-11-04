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
