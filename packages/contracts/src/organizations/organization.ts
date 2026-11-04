import { z } from "zod";
import { Role } from "../auth/roles.js";

export const SubscriptionStatus = z.enum([
  "trialing",
  "active",
  "past_due",
  "canceled",
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

/**
 * API-facing shape — deliberately not 1:1 with the `organizations` table.
 * Razorpay customer/subscription ids never leave the API; the frontend
 * only ever sees plan + status.
 */
export const Organization = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  plan: z.string(),
  subscriptionStatus: SubscriptionStatus,
  createdAt: z.string().datetime(),
});
export type Organization = z.infer<typeof Organization>;

export const OrgMember = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  role: Role,
});
export type OrgMember = z.infer<typeof OrgMember>;
