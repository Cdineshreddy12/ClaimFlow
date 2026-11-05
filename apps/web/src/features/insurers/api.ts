import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InsurerInput, InsurerType } from "@claimflow/contracts";
import { api } from "../../lib/api-client";

export interface Insurer {
  id: string;
  name: string;
  type: InsurerType;
  code: string | null;
  contactEmail: string | null;
  isActive: boolean;
  /** How much already depends on this one — shown before anyone retires it. */
  claimCount: number;
  ruleCount: number;
}

export function useInsurers(includeInactive = false) {
  return useQuery({
    queryKey: ["insurers", { includeInactive }],
    queryFn: () =>
      api.get<Insurer[]>(
        `/insurers${includeInactive ? "?includeInactive=true" : ""}`,
      ),
  });
}

/** Claim creation and the checklist both read this list, so they refetch too. */
function useInsurerMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurers"] });
      queryClient.invalidateQueries({ queryKey: ["reference"] });
    },
  });
}

export function useCreateInsurer() {
  return useInsurerMutation((body: InsurerInput) =>
    api.post<Insurer>("/insurers", body),
  );
}

export function useUpdateInsurer() {
  return useInsurerMutation(({ id, ...body }: InsurerInput & { id: string }) =>
    api.put<Insurer>(`/insurers/${id}`, body),
  );
}

export function useSetInsurerActive() {
  return useInsurerMutation(
    ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch<Insurer>(`/insurers/${id}/active`, { isActive }),
  );
}

export function useDeleteInsurer() {
  return useInsurerMutation((id: string) => api.delete(`/insurers/${id}`));
}
