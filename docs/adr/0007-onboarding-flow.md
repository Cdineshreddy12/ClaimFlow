# 0007 — Self-serve onboarding flow

**Superseded in part, 2026-11-04: ClaimFlow is single-tenant.** Written
hours before the multi-tenancy removal
([`0002`](0002-authorization-and-tenant-isolation.md)) and never updated
after. The shape of the flow below mostly survived — there's still an
`authenticateUserOnly` preHandler, still exactly one route an org-less
user can reach, still shareable invite links — but every reference to
`organizations`/`org_members` is now `hospital_profile`/`members`, and
"create an organization" became "set up the one hospital this install
is for." The real route is `POST /hospital` in
`apps/api/src/modules/onboarding/onboarding.routes.ts`, and a second
setup attempt gets a 409 ("this ClaimFlow is already set up — ask for
an invite link") rather than creating another tenant, because there
is no longer a concept of another tenant to create. The 14-day,
no-card trial is real; Razorpay enforcement at trial-expiry is not,
same as ADR 0006. The content below is the original flow design, kept
as the reasoning that shaped what got built.

## Context

[`0006-billing-and-onboarding.md`](0006-billing-and-onboarding.md) decided
the shape — self-serve signup, Razorpay for billing, `org_admin` owns
setup — but left the actual flow, and the trial length, undecided. This
works both out in enough detail to build against.

It also surfaces a real gap in the current auth design: `authenticate`
(`apps/api/src/middleware/authenticate.ts`) hard-requires
`organization_id`/`role` to already be on the token, 403ing otherwise.
That's correct for every route today, but a user who just signed up has
neither — `org_members` doesn't exist for them yet. There has to be
exactly one endpoint reachable by an authenticated-but-org-less user:
"create my organization."

## Decision

### The flow

1. **Sign up** (`/signup`) — hospital name, email, password, via Supabase
   Auth directly (we never touch the credential). Email confirmation is
   required before login, using Supabase's built-in flow — standard
   practice, and consistent with the DPDP-conscious posture the stack
   already took (Mumbai region, service-role key never shipped to the
   client).

2. **Org creation, and the org-less auth problem** — the fresh Supabase
   JWT has no org/role claims (the Custom Access Token Hook finds no
   `org_members` row to stamp from). A new `authenticateUserOnly`
   preHandler — verifies the JWT, reads only `sub`, skips the org/role
   check entirely — guards exactly one new endpoint:
   `POST /onboarding/organizations`. It creates `organizations` +
   an `org_members` row (`role: org_admin`) in one transaction. The
   frontend then calls `supabase.auth.refreshSession()`; the hook re-runs
   on refresh, finds the row, and the new token carries real claims.
   Every route after this point is the existing `authenticate`, unchanged.

3. **Setup wizard** (`/onboarding/setup`) — pick insurers/TPAs and
   procedures from the shared reference list (add custom ones inline),
   then review a **starter checklist-rules template** (a sensible default
   document list for common procedure types) rather than starting from a
   blank slate. No new backend endpoint — the wizard just calls the
   existing checklist CRUD routes repeatedly, pre-filled from the
   template.

4. **Invite the team** (`/onboarding/invite`, skippable) — a shareable
   link/code per role, not automatic email (decided below). Needs one new
   table: `invites` (`organizationId`, `role`, `token` unique, `createdBy`,
   `expiresAt`, `usedAt`, `usedBy`, `createdAt`). New endpoints:
   `POST /invites` (`org_admin` only, creates one), `GET /invites/:token`
   (looks up org name + role for the accept screen, no auth required),
   `POST /invites/:token/accept` (via the same `authenticateUserOnly`
   preHandler as org creation — an invited user is also org-less until
   this redeems).

5. **Land on Dashboard** — with a real first-run empty state (today's
   bare "No claims yet" isn't that) prompting toward creating the first
   claim — the actual activation moment for this product.

### Trial

**14 days, no card required at signup** — matches the "self-serve"
framing already decided in ADR 0006, and `organizations.subscriptionStatus`
already defaults to `"trialing"`. Needs one new column:
`organizations.trial_ends_at` (timestamp), set at org-creation time.

**Trial expiry behavior — declared now, not built now.** When
`trial_ends_at` passes with no Razorpay subscription attached, the org
goes **read-only**: existing data stays visible, mutating endpoints
(create claim, upload document, confirm, etc.) return a clear "trial
expired" error instead of a hard lockout. This is billing-module
enforcement (not yet built — see ADR 0006) and out of scope for the
onboarding flow itself; it's declared here so the column and the
contract are shaped right instead of retrofitted when that module lands.

### Team invites: link, not email

A shareable invite link needs zero new infrastructure. Automatic email
invites would need a transactional email provider (SES/Resend/Postmark)
picked and wired — a real integration decision on its own, deferred until
there's a concrete reason link-sharing isn't enough.

### A known external blocker

The Supabase Custom Access Token Hook still isn't enabled in the project
dashboard (a manual step outside CLI/SQL reach — true since ADR 0002, not
new here). It's been a non-issue so far because every screen built to
date runs on the `VITE_DEV_TOKEN` dev bridge, not real Supabase sign-in.
Onboarding is the first flow that actually needs it: without the hook,
every real signed-up user's token comes back org-less forever, no matter
how correct the rest of this flow is. **Flagging this now so it isn't
discovered mid-build.**

## Consequences

- Schema additions: `organizations.trial_ends_at`, new `invites` table.
- Auth additions: `authenticateUserOnly` preHandler; the frontend needs a
  real Supabase-session auth layer (`supabase-js`, persisted session,
  `refreshSession()` after org creation and after invite acceptance) —
  this replaces the `VITE_DEV_TOKEN` bridge for the onboarding flow and,
  eventually, for every screen.
- New API module: `apps/api/src/modules/onboarding/` (organizations
  create, invites create/lookup/accept).
- New web routes: `/signup`, `/onboarding/organization`,
  `/onboarding/setup`, `/onboarding/invite`, `/invites/:token`, plus a
  `/login` that doesn't exist yet either — there's been no real login UI
  because the dev-token bridge made one unnecessary until now.
- Billing enforcement (trial-expiry read-only mode, Razorpay webhook
  handling) stays explicitly out of this ADR's scope — ADR 0006 already
  owns it as a planned, not-yet-built module.
