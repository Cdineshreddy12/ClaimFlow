import { api } from "../../lib/api-client";

interface CreateOrganizationResult {
  organization: {
    id: string;
    name: string;
    slug: string;
    trialEndsAt: string | null;
  };
  member: { id: string; role: string };
}

export function createOrganization(name: string) {
  return api.post<CreateOrganizationResult>("/onboarding/organizations", {
    name,
  });
}

export interface InvitePreview {
  organizationName: string;
  role: string;
}

export function previewInvite(token: string) {
  return api.get<InvitePreview>(`/invites/${token}`);
}

export function acceptInvite(token: string) {
  return api.post(`/invites/${token}/accept`);
}
