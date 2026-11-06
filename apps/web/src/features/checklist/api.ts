import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChecklistProposal, ProcedureInput } from "@claimflow/contracts";
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
  /** Retired procedures stay on the admin list and leave every picker. */
  isActive: boolean;
  /** How much depends on it — what decides whether it can be deleted. */
  claims?: number;
  rules?: number;
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

/**
 * Live procedures by default — a picker should never offer one the
 * hospital has stopped doing. Only the admin list asks for the retired
 * ones, so it can show them and put them back.
 */
export function useProcedures(includeInactive = false) {
  return useQuery({
    queryKey: ["procedures", { includeInactive }],
    queryFn: () =>
      api.get<Procedure[]>(
        `/procedures${includeInactive ? "?includeInactive=true" : ""}`,
      ),
    staleTime: 10 * 60 * 1000,
  });
}

function useProcedureMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["procedures"] });
      // A renamed procedure changes what every claim screen and the
      // coverage view call it.
      queryClient.invalidateQueries({ queryKey: ["checklist-rules"] });
    },
  });
}

export function useCreateProcedure() {
  return useProcedureMutation((body: ProcedureInput) =>
    api.post<Procedure>("/procedures", body),
  );
}

export function useUpdateProcedure() {
  return useProcedureMutation(
    ({ id, ...body }: ProcedureInput & { id: string }) =>
      api.patch<Procedure>(`/procedures/${id}`, body),
  );
}

export function useDeleteProcedure() {
  return useProcedureMutation((id: string) => api.delete(`/procedures/${id}`));
}

/** The reversible half: off the pickers, still on every claim that used it. */
export function useSetProcedureActive() {
  return useProcedureMutation(
    ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch<Procedure>(`/procedures/${id}/active`, { isActive }),
  );
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

export function useChecklistProposals() {
  return useQuery({
    queryKey: ["checklist-rules", "proposals"],
    queryFn: () => api.get<ChecklistProposal[]>("/checklist-rules/proposals"),
  });
}

export function useApplyProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      insurerId: string;
      procedureId: string;
      documentType: string;
      action: "add_required" | "make_required";
    }) => api.post("/checklist-rules/proposals/apply", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist-rules"] });
    },
  });
}

export interface CoveragePair {
  insurerId: string;
  insurerName: string;
  procedureId: string;
  procedureName: string;
  rules: number;
  claims: number;
  activeClaims: number;
  lastClaimAt: string | null;
}

export interface ChecklistCoverage {
  uncovered: CoveragePair[];
  covered: CoveragePair[];
  uncoveredClaims: number;
}

/** Which pairs the desk works on, and which of them have no checklist at all. */
export function useChecklistCoverage() {
  return useQuery({
    queryKey: ["checklist-rules", "coverage"],
    queryFn: () => api.get<ChecklistCoverage>("/checklist-rules/coverage"),
  });
}
