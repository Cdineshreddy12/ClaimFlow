import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export interface DoctorApprovalView {
  hospitalName: string;
  patientName: string;
  procedureName: string;
  insurerName: string;
  doctorName: string;
  expiresAt: string;
  documents: { slot: string; downloadUrl: string }[];
}

export function useDoctorApproval(token: string) {
  return useQuery({
    queryKey: ["doctor-approval", token],
    queryFn: () => api.get<DoctorApprovalView>(`/doctor-approval/${token}`),
    enabled: Boolean(token),
    // A doctor following a stale link should see the real reason, not a
    // spinner that retries three times first.
    retry: false,
  });
}

export type Decision = { approved: true } | { approved: false; reason: string };

export function useDecide(token: string) {
  return useMutation({
    mutationFn: (decision: Decision) =>
      api.post(`/doctor-approval/${token}/decide`, decision),
  });
}
