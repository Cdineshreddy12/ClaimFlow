import { z } from "zod";

/**
 * platform_admin — ClaimFlow operator staff, cross-tenant. Any access to a
 *   tenant's data through this role must itself be an audited event
 *   (break-glass) — see docs/adr/0002-authorization-and-tenant-isolation.md.
 * org_admin      — hospital-side owner: billing, users, insurer/checklist config.
 * desk_head      — sees all claims in their org, configures checklists.
 * desk_executive — sees only their own assigned claims.
 * doctor         — token-linked access to their own patients' notes only,
 *   never a full login.
 */
export const Role = z.enum([
  "platform_admin",
  "org_admin",
  "desk_head",
  "desk_executive",
  "doctor",
]);
export type Role = z.infer<typeof Role>;
