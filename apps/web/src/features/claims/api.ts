import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import type { Claim, ClaimGaps } from "./types";

export function useClaims() {
  return useQuery({
    queryKey: ["claims"],
    queryFn: () => api.get<Claim[]>("/claims"),
  });
}

export function useClaim(id: string) {
  return useQuery({
    queryKey: ["claims", id],
    queryFn: () => api.get<Claim>(`/claims/${id}`),
    enabled: Boolean(id),
  });
}

export function useClaimGaps(id: string) {
  return useQuery({
    queryKey: ["claims", id, "gaps"],
    queryFn: () => api.get<ClaimGaps>(`/claims/${id}/gaps`),
    enabled: Boolean(id),
  });
}
