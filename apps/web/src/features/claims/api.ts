import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClaimStatus } from "@claimflow/contracts";
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

/** Anything that changes a claim invalidates the claim, its gaps, and the lists it appears in. */
function useClaimMutation<TArgs, TResult>(
  claimId: string,
  mutationFn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["claims"] });
      queryClient.invalidateQueries({ queryKey: ["claims", claimId] });
      queryClient.invalidateQueries({ queryKey: ["claims", claimId, "gaps"] });
    },
  });
}

export function useCreateClaim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      patientName: string;
      insurerId: string;
      procedureId: string;
      billedAmount?: number | undefined;
      admittedAt?: string | undefined;
    }) => api.post<Claim>("/claims", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["claims"] }),
  });
}

export function useTransitionStatus(claimId: string) {
  return useClaimMutation(claimId, (status: ClaimStatus) =>
    api.patch<Claim>(`/claims/${claimId}/status`, { status }),
  );
}

export interface PacketResult {
  downloadUrl: string;
  documentCount: number;
  skipped: { fileName: string; reason: string }[];
}

export function useGeneratePacket(claimId: string) {
  return useMutation({
    mutationFn: () => api.post<PacketResult>(`/claims/${claimId}/packet`),
  });
}

export interface DoctorApprovalRequest {
  id: string;
  token: string;
  doctorName: string;
  expiresAt: string;
  firstViewedAt: string | null;
  approvedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
}

export function useDoctorApprovals(claimId: string) {
  return useQuery({
    queryKey: ["claims", claimId, "doctor-approvals"],
    queryFn: () =>
      api.get<DoctorApprovalRequest[]>(`/claims/${claimId}/doctor-approvals`),
    enabled: Boolean(claimId),
  });
}

export function useRequestDoctorApproval(claimId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (doctorName: string) =>
      api.post<DoctorApprovalRequest>(`/claims/${claimId}/doctor-approvals`, {
        doctorName,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["claims", claimId, "doctor-approvals"],
      }),
  });
}

export function useLogQuery(claimId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { tpaRawEmail: string }) =>
      api.post(`/claims/${claimId}/queries`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queries", "inbox"] });
      queryClient.invalidateQueries({ queryKey: ["claims", claimId] });
    },
  });
}

export function useRecordDeduction(claimId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { reason: string; amount: number; note?: string }) =>
      api.post(`/claims/${claimId}/deductions`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deductions"] });
      queryClient.invalidateQueries({ queryKey: ["claims", claimId] });
    },
  });
}
