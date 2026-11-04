# 0010 — Doctor approval links

## Context

The brief asks for "doctor approval of notes from a phone link", and the
role model has always said what that means:

> `doctor` — token-linked access to their own patients' notes only, never
> a full login.

Treating doctors are not desk staff. They are chased on WhatsApp today,
they will not create an account, and asking them to sign in to approve
one note would simply not get used.

So the link has to work with no account. That means **the token is the
only credential**, and anyone holding the URL can see one patient's
clinical documents. That is a real exposure, and this record exists to
say what bounds it rather than let it pass unexamined.

## Decision

A desk user requests a link for a named doctor; the API mints an
unguessable token and the desk sends it however they already reach that
doctor. Opening it needs no authentication.

What bounds the exposure:

- **48-hour expiry.** Long enough for a doctor between theatre lists,
  short enough that a forwarded message goes stale.
- **One decision per link.** Once approved or declined the token is spent
  — a second open returns 410, not the patient's notes.
- **Unguessable token.** A v4 UUID, never sequential, never derived from
  the claim id.
- **Narrowest useful payload.** Patient name, procedure, insurer,
  hospital — and read links for _confirmed clinical documents only_.
  No billed amount, no claim reference, no insurer correspondence. A
  Photo ID proof is on the claim but is not the doctor's business, so a
  slot-name match keeps it out.
- **Document URLs are 5-minute pre-signed S3 links**, so the payload
  can't be archived into durable access to the files.
- **Every open and every decision is audited** with a null actor,
  because the holder genuinely has no `org_members` row. Inventing one
  would make the trail lie about who acted.

Declining requires a reason. A bare "no" leaves the desk nothing to act
on, which defeats the point of asking.

## Consequences

- New table `doctor_approvals`, scoped through its claim like `documents`
  and `queries` (no `organization_id` of its own).
- Two public, unauthenticated routes under `/doctor-approval/:token` —
  the only ones in the API besides invite preview. Both are named in
  `server.ts` so that stays visible.
- A `/doctor-approval/:token` page outside `AppShell`: there is no nav to
  offer someone who cannot sign in, and the chrome would imply an app
  they can't reach.

### Known limits

- **A forwarded link works for whoever opens it.** There is no second
  factor. Binding to a phone number via OTP would fix it and is the
  obvious next step if this ever carries more than clinical sign-off.
- **Approval is recorded, not enforced.** Nothing yet blocks a claim
  being submitted while a doctor has declined — the desk sees the
  decision and the reason, and acts on it. Wiring it into the claim state
  machine is a deliberate later decision, not an oversight.
- The link is sent by the desk through their own channel; ClaimFlow does
  not send messages (consistent with docs/adr/0005 — nothing leaves the
  building automatically).
