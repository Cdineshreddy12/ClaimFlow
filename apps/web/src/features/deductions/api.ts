import { useQuery } from "@tanstack/react-query";
import type { DeductionReason } from "@claimflow/contracts";
import { api } from "@/lib/api-client";

export interface DeductionsSummary {
  total: number;
  /** The portion the desk could have prevented — what the 40%-reduction target tracks. */
  avoidableTotal: number;
  byReason: { reason: DeductionReason; total: number; count: number }[];
}

export function useDeductionsSummary() {
  return useQuery({
    queryKey: ["deductions", "summary"],
    queryFn: () => api.get<DeductionsSummary>("/deductions/summary"),
  });
}
