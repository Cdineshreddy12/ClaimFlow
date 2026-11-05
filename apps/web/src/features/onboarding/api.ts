import { api } from "../../lib/api-client";

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
