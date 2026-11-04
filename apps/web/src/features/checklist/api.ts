import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export interface Insurer {
  id: string;
  name: string;
  type: string;
}

export interface Procedure {
  id: string;
  name: string;
  code: string | null;
}

export interface ChecklistRule {
  id: string;
  insurerId: string;
  procedureId: string;
  documentType: string;
  required: boolean;
}

/** The API returns the rules plus how many in-flight claims this pair has — the screen shows that so an admin knows the blast radius of an edit. */
interface ChecklistRulesResponse {
  rules: ChecklistRule[];
  activeClaims: number;
}

export function useInsurers() {
  return useQuery({
    queryKey: ["insurers"],
    queryFn: () => api.get<Insurer[]>("/insurers"),
    staleTime: 10 * 60 * 1000,
  });
}

export function useProcedures() {
  return useQuery({
    queryKey: ["procedures"],
    queryFn: () => api.get<Procedure[]>("/procedures"),
    staleTime: 10 * 60 * 1000,
  });
}

export function useChecklistRules(insurerId: string, procedureId: string) {
  return useQuery({
    queryKey: ["checklist-rules", insurerId, procedureId],
    queryFn: () =>
      api.get<ChecklistRulesResponse>(
        `/checklist-rules?insurerId=${insurerId}&procedureId=${procedureId}`,
      ),
    enabled: Boolean(insurerId && procedureId),
  });
}

function useRuleMutation<TArgs>(
  insurerId: string,
  procedureId: string,
  fn: (args: TArgs) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["checklist-rules", insurerId, procedureId],
      }),
  });
}

export function useCreateRule(insurerId: string, procedureId: string) {
  return useRuleMutation(insurerId, procedureId, (documentType: string) =>
    api.post<ChecklistRule>("/checklist-rules", {
      insurerId,
      procedureId,
      documentType,
      required: true,
    }),
  );
}

export function useUpdateRule(insurerId: string, procedureId: string) {
  return useRuleMutation(
    insurerId,
    procedureId,
    ({ id, required }: { id: string; required: boolean }) =>
      api.patch<ChecklistRule>(`/checklist-rules/${id}`, { required }),
  );
}

export function useDeleteRule(insurerId: string, procedureId: string) {
  return useRuleMutation(insurerId, procedureId, (id: string) =>
    api.delete(`/checklist-rules/${id}`),
  );
}
