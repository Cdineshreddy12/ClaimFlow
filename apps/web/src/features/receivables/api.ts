import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export interface AgeingBucket {
  key: "0_30" | "31_60" | "61_90" | "over_90";
  label: string;
  claims: number;
  total: number;
}

export interface InsurerOutstanding {
  insurerName: string;
  claims: number;
  total: number;
  oldestDays: number;
}

export interface OutstandingClaim {
  claimId: string;
  reference: string | null;
  patientName: string;
  insurerName: string;
  status: string;
  billedAt: string;
  outstanding: number;
  days: number;
}

export interface AgeingReport {
  asOf: string;
  total: number;
  claims: number;
  buckets: AgeingBucket[];
  byInsurer: InsurerOutstanding[];
  oldest: OutstandingClaim[];
}

export function useAgeing() {
  return useQuery({
    queryKey: ["receivables", "ageing"],
    queryFn: () => api.get<AgeingReport>("/receivables/ageing"),
  });
}
