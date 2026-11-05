import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DeductionAppealStatus,
  DeductionReason,
  DeductionRiskAssessment,
} from "@claimflow/contracts";
import { api } from "@/lib/api-client";

export interface DeductionsSummary {
  total: number;
  /** The portion the desk could have prevented — what the 40%-reduction target tracks. */
  avoidableTotal: number;
  /** Clawed back on appeal in the same window — docs/adr/0013. */
  recoveredTotal: number;
  byReason: {
    reason: DeductionReason;
    total: number;
    count: number;
    recovered: number;
  }[];
}

export function useDeductionsSummary() {
  return useQuery({
    queryKey: ["deductions", "summary"],
    queryFn: () => api.get<DeductionsSummary>("/deductions/summary"),
  });
}

export function useDeductionRisk(claimId: string) {
  return useQuery({
    queryKey: ["claims", claimId, "deduction-risk"],
    queryFn: () =>
      api.get<DeductionRiskAssessment>(`/claims/${claimId}/deductions/risk`),
    enabled: Boolean(claimId),
  });
}

export interface Deduction {
  id: string;
  claimId: string;
  reason: DeductionReason;
  amount: string;
  note: string | null;
  appealStatus: DeductionAppealStatus;
  recoveredAmount: string | null;
  contestedAt: string | null;
  resolvedAt: string | null;
  appealNote: string | null;
  createdAt: string;
}

export interface AppealWorklistRow extends Deduction {
  claimReference: string;
  patientName: string;
  insurerName: string;
}

export function useClaimDeductions(claimId: string) {
  return useQuery({
    queryKey: ["claims", claimId, "deductions"],
    queryFn: () => api.get<Deduction[]>(`/claims/${claimId}/deductions`),
    enabled: Boolean(claimId),
  });
}

export function useAppealWorklist(status?: DeductionAppealStatus) {
  return useQuery({
    queryKey: ["deductions", "appeals", status ?? "open"],
    queryFn: () =>
      api.get<AppealWorklistRow[]>(
        status ? `/deductions/appeals?status=${status}` : "/deductions/appeals",
      ),
  });
}

/** An appeal changes the claim's money and the hospital's recovery totals. */
function useAppealMutation<TArgs, TResult>(
  claimId: string,
  mutationFn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      for (const key of [
        ["claims", claimId, "deductions"],
        ["claims", claimId, "deduction-risk"],
        ["claims", claimId, "financials"],
        ["deductions", "summary"],
        ["deductions", "appeals"],
      ]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useContestDeduction(claimId: string) {
  return useAppealMutation(
    claimId,
    ({ deductionId, note }: { deductionId: string; note?: string }) =>
      api.patch<Deduction>(
        `/claims/${claimId}/deductions/${deductionId}/contest`,
        note ? { note } : {},
      ),
  );
}

export function useResolveAppeal(claimId: string) {
  return useAppealMutation(
    claimId,
    ({
      deductionId,
      ...body
    }: {
      deductionId: string;
      recoveredAmount: number;
      note?: string;
    }) =>
      api.patch<Deduction>(
        `/claims/${claimId}/deductions/${deductionId}/appeal`,
        body,
      ),
  );
}
