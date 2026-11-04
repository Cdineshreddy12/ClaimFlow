import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  HospitalComplianceStep,
  HospitalContactStep,
  HospitalIdentityStep,
  HospitalType,
  NabhStatus,
  OwnershipType,
} from "@claimflow/contracts";
import { api } from "../../lib/api-client";

/** Mirrors the organizations row — every profile field is nullable until the wizard fills it. */
export interface CurrentOrganization {
  id: string;
  name: string;
  slug: string;
  plan: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;

  legalEntityName: string | null;
  hospitalType: HospitalType | null;
  ownershipType: OwnershipType | null;
  bedCount: number | null;

  rohiniId: string | null;
  registrationNumber: string | null;
  registrationValidUntil: string | null;
  pan: string | null;
  gstin: string | null;
  nabhStatus: NabhStatus | null;
  nabhValidUntil: string | null;

  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;

  deskContactName: string | null;
  deskContactPhone: string | null;
  deskContactEmail: string | null;

  onboardingCompletedAt: string | null;
}

export function useCurrentOrganization() {
  return useQuery({
    queryKey: ["organizations", "me"],
    queryFn: () => api.get<CurrentOrganization>("/organizations/me"),
    staleTime: 60 * 1000,
  });
}

export type ProfileStepPayload =
  | { step: "identity"; data: HospitalIdentityStep }
  | { step: "compliance"; data: HospitalComplianceStep }
  | { step: "contact"; data: HospitalContactStep };

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProfileStepPayload) =>
      api.patch<CurrentOrganization>("/organizations/me/profile", payload),
    onSuccess: (organization) => {
      // Seed the cache directly — the wizard reads defaults straight back
      // out of it when stepping backwards.
      queryClient.setQueryData(["organizations", "me"], organization);
    },
  });
}
