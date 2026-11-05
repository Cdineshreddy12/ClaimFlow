import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  HospitalBrandingStep,
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

  logoFileKey: string | null;
  /** Short-lived, resolved server-side — the bucket is private. Re-fetch the hospital if it expires. */
  logoUrl: string | null;
  brandAccentColor: string | null;
  tagline: string | null;
  documentFooterNote: string | null;

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
  | { step: "contact"; data: HospitalContactStep }
  | { step: "branding"; data: HospitalBrandingStep };

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

/** Step 1 of the logo upload flow: a pre-signed PUT URL, straight to S3 — the API never sees the bytes (docs/adr/0003). */
export function useUploadLogo() {
  const queryClient = useQueryClient();
  const updateProfile = useUpdateProfile();
  return useMutation({
    mutationFn: async (file: File) => {
      const { uploadUrl, key } = await api.post<{
        uploadUrl: string;
        key: string;
      }>("/hospital/branding/logo-upload-url", {
        fileName: file.name,
        contentType: file.type,
      });

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error("upload to storage failed");

      return updateProfile.mutateAsync({
        step: "branding",
        data: { logoFileKey: key },
      });
    },
    onSuccess: (hospital) => {
      queryClient.setQueryData(["hospital"], hospital);
    },
  });
}
