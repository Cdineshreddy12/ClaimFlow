# 0006 — Billing and onboarding

## Context

ClaimFlow sells to Indian hospitals as a subscription SaaS. Hospital finance
departments expect GST-compliant invoicing, which most Indian B2B buyers
treat as a hard requirement, not a nice-to-have.

## Decision

- **Billing provider: Razorpay Subscriptions**, not Stripe. Razorpay handles
  GST invoicing natively for the India market; Stripe's India support is
  weaker on this specific point, and it's the point that actually matters
  to the buyer's finance team.
- **Onboarding is self-serve**: a hospital signs up, creates an
  `organizations` row, and the first user becomes `org_admin`. The
  `org_admin` then invites `desk_head` / `desk_executive` / `doctor` users
  and configures which insurers their checklist rules apply to.
- **Plan/subscription state lives on `organizations`**
  (`subscription_status`, `plan`, `razorpay_customer_id`,
  `razorpay_subscription_id`) — never duplicated per-user.
- A platform **super-admin console** (cross-tenant visibility for support,
  billing issue resolution, tenant suspension) is required before scaling
  past a handful of tenants, but is not yet built. Any access through it
  must be an audited break-glass event per
  [`0002-authorization-and-tenant-isolation.md`](0002-authorization-and-tenant-isolation.md).

## Consequences

- `apps/api/src/modules/billing/` and `apps/api/src/modules/onboarding/`
  are planned modules, not yet implemented — this ADR exists so the schema
  (`organizations.razorpay_*` columns) and the role model (`org_admin`)
  are already shaped correctly for them rather than retrofitted later.
- The actual signup → org creation → setup → invite flow, and the trial
  length (14 days, no card required), are worked out in
  [`0007-onboarding-flow.md`](0007-onboarding-flow.md) — including a real
  auth-architecture gap that flow exposes (an authenticated user with no
  org yet can't call any route today).
- Grace-period handling once a _paying_ subscription lapses
  (`subscription_status` moving to `past_due` after a real Razorpay
  subscription existed, as opposed to a trial simply expiring) is still
  open — flag before building the billing module itself.
