import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ClaimFinancials,
  ClaimOverview,
  ClaimStatus,
  PreauthReview,
} from "@claimflow/contracts";
import { api } from "../../lib/api-client";
import type { Claim, ClaimGaps, Enhancement } from "./types";

/**
 * Every claim, for the things that need totals rather than a page —
 * the dashboard's charts, the assistant's claim matching.
 */
export function useClaims() {
  return useQuery({
    queryKey: ["claims"],
    queryFn: () => api.get<Claim[]>("/claims"),
  });
}

/**
 * The dashboard's numbers, counted in the database.
 *
 * Replaces fetching every claim and computing six figures, a donut, a
 * six-month trend and an attention list over the array in the browser.
 */
export function useClaimOverview() {
  return useQuery({
    queryKey: ["claims", "overview"],
    queryFn: () => api.get<ClaimOverview>("/claims/overview"),
  });
}

/**
 * One page, filtered, searched and sorted in the database.
 *
 * The list screen used to fetch every claim the hospital had ever
 * opened and do all of this in the browser. `keepPreviousData` holds
 * the current page on screen while the next one loads, so paging and
 * typing in the search box don't blank the table on every keystroke.
 */
export function useClaimsPage(params: {
  q: string;
  statusFilter: string;
  sort: string;
  dir: string;
  limit: number;
  offset: number;
}) {
  const search = new URLSearchParams({
    statusFilter: params.statusFilter,
    sort: params.sort,
    dir: params.dir,
    limit: String(params.limit),
    offset: String(params.offset),
    ...(params.q.trim() ? { q: params.q.trim() } : {}),
  });
  return useQuery({
    queryKey: ["claims", "page", search.toString()],
    queryFn: () =>
      api.get<{ rows: Claim[]; total: number }>(`/claims?${search}`),
    placeholderData: (previous) => previous,
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

export function useClaimFinancials(id: string) {
  return useQuery({
    queryKey: ["claims", id, "financials"],
    queryFn: () => api.get<ClaimFinancials>(`/claims/${id}/financials`),
    enabled: Boolean(id),
  });
}

/**
 * Anything that moves money on a claim invalidates the financials, the
 * enhancements and the deduction risk alongside the claim itself —
 * they're four views of one set of facts.
 */
function useMoneyMutation<TArgs, TResult>(
  claimId: string,
  mutationFn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      for (const key of [
        ["claims"],
        ["claims", claimId],
        ["claims", claimId, "financials"],
        ["claims", claimId, "enhancements"],
        ["claims", claimId, "deductions"],
        ["claims", claimId, "deduction-risk"],
        ["sla"],
      ]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useUpdateFinancials(claimId: string) {
  return useMoneyMutation(
    claimId,
    (body: { sanctionedAmount?: number; billedAmount?: number }) =>
      api.patch<Claim>(`/claims/${claimId}/financials`, body),
  );
}

export function useEnhancements(claimId: string) {
  return useQuery({
    queryKey: ["claims", claimId, "enhancements"],
    queryFn: () => api.get<Enhancement[]>(`/claims/${claimId}/enhancements`),
    enabled: Boolean(claimId),
  });
}

export function useRequestEnhancement(claimId: string) {
  return useMoneyMutation(
    claimId,
    (body: { requestedAmount: number; reason: string }) =>
      api.post<Enhancement>(`/claims/${claimId}/enhancements`, body),
  );
}

export function useDecideEnhancement(claimId: string) {
  return useMoneyMutation(
    claimId,
    ({
      enhancementId,
      ...body
    }: {
      enhancementId: string;
      outcome: "APPROVED" | "PARTIALLY_APPROVED" | "REJECTED" | "WITHDRAWN";
      approvedAmount?: number;
    }) =>
      api.patch<Enhancement>(
        `/claims/${claimId}/enhancements/${enhancementId}`,
        body,
      ),
  );
}

/**
 * A mutation rather than a query: the clinical half costs a model call,
 * so it runs when the desk asks for it, not on every render.
 */
export function useReviewForm(claimId: string) {
  return useMutation({
    mutationFn: () =>
      api.post<PreauthReview>(`/claims/${claimId}/preauth-fields/review`, {}),
  });
}

export function useRecordPayment(claimId: string) {
  return useClaimMutation(
    claimId,
    (body: { settledAmount: number; settledOn: string }) =>
      api.patch<Claim>(`/claims/${claimId}/payment`, body),
  );
}

/**
 * The filled claim form as a PDF.
 *
 * Fetched as a blob rather than linked directly: the endpoint needs the
 * Authorization header, which a plain <a href> can't send.
 */
export async function downloadPreauthForm(claimId: string, reference: string) {
  const blob = await api.getBlob(`/claims/${claimId}/preauth-fields/form.pdf`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `preauth-${reference}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick — Safari cancels the download if the URL
  // disappears in the same frame as the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Gives a claim opened with no checklist the one it should have had.
 *
 * Only works while the claim has none — the server refuses otherwise,
 * which is what stops this being a way to re-snapshot a claim whose
 * requirements were already decided (docs/adr/0001).
 */
export function useApplyChecklistRules(claimId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<unknown>(`/claims/${claimId}/checklist-slots/apply-rules`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["claims", claimId] });
      queryClient.invalidateQueries({ queryKey: ["claims"] });
    },
  });
}

/**
 * Takes a hand-added slot back off a claim.
 *
 * Only ever one a person added, and only while nothing is filed in it
 * — the server refuses both other cases, so this needs no guard of its
 * own beyond showing the refusal.
 */
export function useRemoveChecklistSlot(claimId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentType: string) =>
      api.delete<unknown>(
        `/claims/${claimId}/checklist-slots?documentType=${encodeURIComponent(documentType)}`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["claims", claimId] });
    },
  });
}
