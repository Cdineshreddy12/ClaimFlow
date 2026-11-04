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

/** Mirrors the hospital_profile row — every profile field is nullable until the wizard fills it. */
export interface Hospital {
  id: string;
  name: string;

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

export function useHospital() {
  return useQuery({
    queryKey: ["hospital"],
    queryFn: () => api.get<Hospital>("/hospital"),
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
      api.patch<Hospital>("/hospital/profile", payload),
    onSuccess: (hospital) => {
      // Seed the cache directly — the wizard reads defaults straight back
      // out of it when stepping backwards.
      queryClient.setQueryData(["hospital"], hospital);
    },
  });
}
