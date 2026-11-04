import { api } from "../../lib/api-client";

interface SetUpHospitalResult {
  hospital: { id: string; name: string };
  member: { id: string; role: string };
}

export function setUpHospital(name: string) {
  return api.post<SetUpHospitalResult>("/onboarding/hospital", { name });
}

export interface InvitePreview {
  hospitalName: string;
  role: string;
}

export function previewInvite(token: string) {
  return api.get<InvitePreview>(`/invites/${token}`);
}

export function acceptInvite(token: string) {
  return api.post(`/invites/${token}/accept`);
}
