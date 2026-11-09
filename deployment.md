# Deployment

ClaimFlow is a pnpm workspace: a Fastify API (`apps/api`), a React SPA
(`apps/web`), and a shared contracts package (`packages/contracts`) that
both import. Postgres and auth are Supabase; document storage is S3.

---

## Demo logins

One hospital per install, so these three accounts all belong to the same
desk and differ only by role. Sign in at the web app's `/login`.

| Role           | Email                              | Sees                                                          |
| -------------- | ---------------------------------- | ------------------------------------------------------------- |
| Org Admin      | `desk.admin@claimflow.example.com` | Everything, including Checklist Admin and inviting colleagues |
| Desk Head      | `desk.head@claimflow.example.com`  | All claims on the desk; can settle a claim                    |
| Desk Executive | `desk.exec@claimflow.example.com`  | Only claims assigned to them; cannot settle                   |

The passwords are not in this file and will not be. A password written
down in a public repository is a password anyone can read, and rotating
it does not un-publish the old one — so it does not go in a tracked
file, a screenshot, or a commit message. Ask whoever runs the demo, or
set your own from Supabase → Authentication → Users.

The role split is worth exercising — it's enforced in the API, not just
hidden in the UI. Signing in as **Desk Executive** shows one claim
(CLM-0001, the only one assigned to them) where **Desk Head** shows
three; the executive also has no "Mark settled" action, because
`canTransition` in `packages/contracts` refuses it for that role and the
UI renders from the same table the API enforces.

These are throwaway accounts on a demo database seeded with invented
patients. No real personal data exists anywhere in this project.

---

## Running it locally

**Prerequisites:** Node 20+, pnpm 9+, and a Postgres database. Supabase
is assumed (the auth integration expects it), but any Postgres works for
everything except sign-in.

```bash
git clone https://github.com/Cdineshreddy12/ClaimFlow.git
cd ClaimFlow
pnpm install
cp .env.example .env          # then fill it in — see the table below
pnpm --filter @claimflow/api db:migrate
pnpm --filter @claimflow/api db:seed
pnpm dev
```

`pnpm dev` runs both apps in parallel:

|     |                                              |
| --- | -------------------------------------------- |
| Web | http://localhost:5175                        |
| API | http://localhost:4200 (override with `PORT`) |

Point `VITE_API_URL` at wherever the API is listening.

### One manual Supabase step

Sign-in will fail until the **Custom Access Token hook** is enabled:
Dashboard → Authentication → Hooks → Custom Access Token → select
`public.custom_access_token_hook`. That's a dashboard toggle, not SQL,
so migration `0002` can't do it. Without it the JWT carries no role
claim and every API call returns 403.

Migration `0014` grants the hook's own database permissions. Skipping it
produces `Error running hook URI: pg-functions://…` on every login,
which looks like a credentials problem and isn't.

### Checks

```bash
pnpm lint        # eslint
pnpm typecheck   # tsc across all three packages
pnpm test        # unit + integration
pnpm build
```

Integration tests run against whatever `DATABASE_URL` points at and
**skip themselves** when it is unset, so `pnpm test` works on a clean
checkout with no database. They write and clean up their own rows; point
them at a scratch database rather than one you care about.

---

## Environment variables

Names only — never commit values. `.env` is gitignored and a single root
`.env` serves both apps.

| Variable                    | Used by | What it's for                                                              |
| --------------------------- | ------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`              | api     | Postgres connection string                                                 |
| `PORT`                      | api     | API port (4200 in the sample env)                                          |
| `NODE_ENV`                  | api     | `production` hard-rejects dev-signed HS256 tokens                          |
| `SUPABASE_URL`              | api     | Project URL; JWKS is fetched from it to verify tokens                      |
| `SUPABASE_ANON_KEY`         | api     | Public key                                                                 |
| `SUPABASE_SERVICE_ROLE_KEY` | api     | Admin operations. Optional; unset today                                    |
| `SUPABASE_JWT_SECRET`       | api     | Local dev tokens only. A placeholder, not the project secret               |
| `ANTHROPIC_API_KEY`         | api     | Document sorting, query summaries, pre-auth extraction, the desk assistant |
| `AWS_REGION`                | api     | S3 region                                                                  |
| `AWS_S3_BUCKET`             | api     | Document bucket                                                            |
| `AWS_ACCESS_KEY_ID`         | api     | S3 + Textract credentials                                                  |
| `AWS_SECRET_ACCESS_KEY`     | api     | "                                                                          |
| `AWS_TEXTRACT_REGION`       | api     | OCR region, if different from S3                                           |
| `VITE_API_URL`              | web     | Where the SPA calls the API                                                |
| `VITE_SUPABASE_URL`         | web     | Project URL                                                                |
| `VITE_SUPABASE_ANON_KEY`    | web     | Public anon key — shipped in the bundle by design                          |
| `VITE_DEV_TOKEN`            | web     | **Local only.** See the warning below                                      |

### `VITE_DEV_TOKEN` — do not set this in a deployed environment

It is a signed bearer token that bypasses sign-in entirely, for local
work without Supabase. `apps/web/vite.config.ts` injects it through a
`apply: "serve"` plugin, so it exists only under the dev server and is
pinned to `""` at build time.

That indirection is deliberate. Reading it from `import.meta.env` in
application code puts the literal in the production bundle — and
guarding the read with `import.meta.env.DEV` does **not** help, because
the minifier hoists the string to a const before folding the dead
branch. The token shipped inside `dist/` until this was found by
grepping the built output.

If you set `VITE_DEV_TOKEN` in a deploy environment it is ignored. The
API refuses dev-signed tokens when `NODE_ENV=production` regardless.

---

## Deploying

Not currently deployed. The pieces and what each needs:

**API** — a Node 20 host (Fly, Railway, Render, a container).
`pnpm --filter @claimflow/api build` then `node apps/api/dist/server.js`.
Needs every `api` variable above, plus `NODE_ENV=production`. It talks
to Postgres directly over `DATABASE_URL`, so the host needs outbound
access to Supabase.

**Web** — a static host (Vercel, Netlify, S3+CloudFront).
`pnpm --filter @claimflow/web build` emits `apps/web/dist`. Needs the
`VITE_*` variables at **build** time, since Vite inlines them. Serve
`index.html` for unknown paths — it's a client-routed SPA.

**Database** — run `db:migrate` against the target before the API
starts. Migrations are ordered and idempotent where it matters; `0015`
deletes rows belonging to any non-oldest organization as part of
collapsing the old multi-tenant schema, so read it before running it on
data you care about.

**S3** — the browser uploads straight to S3 with a pre-signed URL, so
the bucket needs a CORS rule allowing `PUT` and `GET` from the web app's
origin. That rule lives on the bucket, not in this repo. The IAM policy
the API needs is in `infra/iam/claimflow-api-policy.json`, with the
reasoning for each grant in `infra/iam/README.md`.

### Without an Anthropic key

Everything still runs. Document sorting falls back to filename matching
and labels itself "Matched by filename" rather than claiming a model
read the page. Pre-auth extraction has no fallback — there is no way to
guess an ICD-10 code from a filename — so the button reports that it
needs a key instead of silently finding nothing.
