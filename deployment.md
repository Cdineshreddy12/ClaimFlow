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
pnpm --filter @claimflow/api db:seed:demo   # six months of history, optional
pnpm --filter @claimflow/api db:verify      # assert the data is coherent
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
| `DATA_RESIDENCY_ACK`        | api     | Escape hatch if the boot-time residency check fails. See below             |
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

## CI/CD

Two workflows, chained: [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
gates every pull request and every push to `main`; nothing deploys until
it's green. [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
only fires once CI has already passed on `main` — a pull request runs CI
and stops there.

### Continuous integration — `ci.yml`

One job, four steps, the same checks a contributor runs locally:

```yaml
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`--frozen-lockfile` is the point: CI refuses to run against a
`pnpm-lock.yaml` that doesn't match `package.json`, rather than silently
resolving different versions than what a clone gets. It runs on every
PR against `main` and on every push to `main` — a merge doesn't skip
the checks a PR already ran, since `main` itself could have moved.

### Continuous deployment — `deploy.yml`

Triggered by `workflow_run: ["CI"]` with `types: [completed]`, filtered
to `branches: [main]` and `conclusion == 'success'` inside the job —
**not** a separate `push` trigger, so the deploy is structurally unable
to run against code CI hasn't already passed. A `concurrency` group
(`deploy-production`, `cancel-in-progress: false`) serializes deploys:
two merges close together queue rather than racing to update the same
ECS service, where the loser would quietly win.

**No AWS keys are stored in GitHub.** The job asks GitHub for a
short-lived OIDC token (`permissions: id-token: write`) and trades it
for `claimflow-demo-github-deploy`, whose permissions name this app's
own ECR repository, service, bucket and distribution — nothing else in
the account — and whose trust policy accepts exactly one subject:

```
repo:Cdineshreddy12@142651342/ClaimFlow@1445047547:ref:refs/heads/main
```

Those numbers are not a typo, and the documented
`repo:OWNER/REPO:ref:refs/heads/main` form does **not** work here. This
repository issues tokens whose subject carries the immutable owner and
repository IDs, so a trust policy written the documented way is refused
with `Not authorized to perform sts:AssumeRoleWithWebIdentity` and no
further explanation. If you ever recreate the role, read the real
subject out of the failed attempt rather than guessing at it:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity \
  --max-results 1 --query 'Events[0].CloudTrailEvent' --output text | jq -r '.userIdentity.userName'
```

The ID form is the better one to pin anyway: renaming the repository or
the account cannot silently widen it, and nobody can claim it by
creating a repository of the same name.

Two jobs run in parallel, both gated on the same CI success:

**`api`** — builds and rolls the Fargate service:

1. Runs on `ubuntu-24.04-arm`, not the default `ubuntu-latest`. The
   Fargate task is Graviton (arm64); cross-building that under QEMU on
   an x86 runner works but takes roughly five times as long for the
   same image, so the runner's architecture matches the target rather
   than emulating it.
2. Logs into ECR via the assumed role, builds
   `apps/api/Dockerfile`, and pushes it tagged with both the commit SHA
   and `latest`. The commit tag is what makes a rollback a one-line
   change — point the service at an earlier task definition — rather
   than a rebuild, and what makes "which code is running?" answerable.
3. Renders a new task definition revision pointing at that image, and
   registers it **once**, reused for both the migration task and the
   service rollout below — so the schema is migrated by exactly the
   image that then serves, not a different revision than ships.
4. Runs migrations as a one-off Fargate task on that new revision,
   **before** the service rolls (`aws ecs run-task` with a command
   override, then `wait tasks-stopped` and check the exit code). A
   non-zero exit fails the job with the old version still serving,
   rather than rolling out code whose schema never arrived. The runner
   itself is idempotent, so a release needing no migration costs one
   query.
5. Rolls the ECS service to the new task definition and
   `aws ecs wait services-stable` — the difference between "deployed"
   and "started." The service's deployment circuit breaker is enabled
   with rollback, so an image that starts but never reaches steady
   state reverts to the previous revision on its own, and this step
   still fails the job rather than leaving the demo down and the run
   green.

**`web`** — builds and publishes the SPA, independently of the API job:

1. Builds `apps/web` with the three `VITE_*` values as build-time env
   — Vite inlines them, so they're build inputs, not runtime
   configuration. `VITE_API_URL` is a plain repo variable;
   `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are repo secrets for log
   hygiene, not confidentiality — the anon key ships inside the bundle
   by design either way.
2. Syncs `apps/web/dist` to the web S3 bucket in a specific order:
   hashed, content-addressed assets first, cached hard
   (`public,max-age=31536000,immutable`) and excluding `index.html`;
   then `index.html` itself, `no-cache,no-store,must-revalidate`. In
   that order, so the bundle files a new `index.html` names are already
   in place by the time anything requests it — reversing the order
   would let a browser fetch the new `index.html` before its assets
   exist in the bucket.
3. Invalidates CloudFront for `/index.html` and `/`, so the one
   uncached object doesn't serve stale out of the edge cache between
   deploys.

Configuration lives in repo variables (`AWS_ROLE_ARN`, `AWS_REGION`,
`ECR_REPOSITORY`, `ECS_CLUSTER`, `ECS_SERVICE`, `ECS_TASK_FAMILY`,
`ECS_TASK_SUBNET`, `ECS_TASK_SECURITY_GROUP`, `WEB_BUCKET`,
`WEB_DISTRIBUTION_ID`, `VITE_API_URL`). Only the two Supabase build
values are secrets.

---

## AWS services

What's actually in use, and why — the IAM policies backing this are
checked into [`infra/iam/`](infra/iam), not just described in prose.

**S3 — two buckets, two jobs.** A documents bucket
(`zopkit-staging-claimflow-documents`) holds scanned uploads and merged
PDF packets; the browser writes to it directly with a pre-signed URL
the API issues, so the bucket needs its own CORS rule allowing `PUT`
and `GET` from the web app's origin — that rule lives on the bucket,
not in this repo. A separate web bucket (`WEB_BUCKET`) holds the built
SPA, written only by the `web` deploy job above, served through
CloudFront rather than directly.

**CloudFront** fronts the web bucket — it's what the deploy job
invalidates after every publish, and it's what makes `index.html`
`no-cache` meaningful (the edge would otherwise cache it anyway). In
this deployment the API's own public URL is also a CloudFront domain;
exactly how that origin is wired (which load balancer or service
discovery sits between it and the Fargate tasks) was set up directly in
the AWS console and isn't captured as code anywhere in this repo — worth
knowing if you go looking for it and don't find it.

**ECS Fargate** runs the API container — see Continuous deployment
above for the task definition / migration / rollout mechanics. No EC2
to patch; the circuit breaker is what makes a bad deploy self-heal
instead of paging someone.

**ECR** is the API's image registry — one repository, commit-tagged
images plus a floating `latest`.

**Textract** does OCR on handwritten doctors' notes, feeding the AI
classifier (`docs/adr/0003`). The IAM grant is deliberately narrow —
`textract:DetectDocumentText` only, nothing else — see
[`infra/iam/README.md`](infra/iam/README.md) for exactly which Textract
APIs were ruled out and why (the async API would need its own S3 read
access; the sync call takes bytes inline and doesn't).

**Two separate IAM identities, two separate blast radii:**

- `claimflow-demo-github-deploy` — the GitHub OIDC role CI assumes, no
  long-lived keys anywhere. Scoped to this app's own ECR repository,
  ECS service, and the two S3/CloudFront pairs above; trust policy
  pinned to this repository's immutable ID on `refs/heads/main` only
  (see the CI/CD section above for why the documented trust-policy form
  doesn't work here).
- `claimflow-api` — the runtime user the API server authenticates as.
  Scoped to one S3 bucket's objects (not the web bucket) plus the one
  Textract action above, nothing else — this key lives in developer
  `.env` files, so it was never given a broad deployment credential's
  reach. The exact policy JSON is
  [`infra/iam/claimflow-api-policy.json`](infra/iam/claimflow-api-policy.json).

**Region.** `AWS_REGION` for the GitHub Actions deploy (where ECR/ECS
live) is a separate repo variable from the API's own `AWS_REGION` env
var (where S3/Textract live) — nothing requires them to match, and
they're set independently. The documents bucket and Textract calls are
meant to run in Mumbai (`ap-south-1`) for DPDP data residency; see
`DATA_RESIDENCY_ACK` below for the check that enforces this and the
escape hatch for an environment that can't meet it.

---

## Containers

Both halves build as images from the repository root, because each is
one package in a pnpm workspace and the lockfile that pins it lives at
the top.

```bash
docker compose up --build       # web :8080, api :4200
```

`compose` reads `.env` for the API and passes the three `VITE_*` values
in as **build arguments** — Vite inlines them into the bundle, so a
container started with a different `VITE_API_URL` still calls the old
one. Changing where the web app points means rebuilding it, not
restarting it.

Built separately:

```bash
docker build -f apps/api/Dockerfile -t claimflow-api .

docker build -f apps/web/Dockerfile \
  --build-arg VITE_API_URL=https://api.example.com \
  --build-arg VITE_SUPABASE_URL=https://xyz.supabase.co \
  --build-arg VITE_SUPABASE_ANON_KEY=... \
  -t claimflow-web .
```

The API image is ~335MB and carries the bundle plus production
dependencies: no pnpm, no TypeScript, no source. It runs as `node`
rather than root and has a `HEALTHCHECK` against the `/health` route
the app already serves. The web image is ~78MB of nginx, configured to
fall back to `index.html` so a reload on `/claims/<id>` is not a 404.

Only the Supabase **anon** key belongs in the web build. It is public
by design — the browser sends it on every request — which is why
Docker's `SecretsUsedInArgOrEnv` warning on that line is noise. The
service role key is not public and the web app never needs it.

### `DATABASE_URL` must be the pooler, not the direct connection

This is the one that will catch you, and it is not a Docker problem:

```
$ dig +short A    db.<ref>.supabase.co     # → nothing
$ dig +short AAAA db.<ref>.supabase.co     # → 2406:da14:...
```

Supabase's direct database host publishes **no A record**. A container
on Docker's default bridge has no IPv6 route, so it fails with
`ENETUNREACH` — and it fails _late_: the API starts, reports healthy,
serves `/health`, and only dies when something actually queries. Most
managed hosts have the same gap.

Use the Supavisor pooler, which answers on IPv4:

```
postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

Port 6543 is transaction mode, which forbids prepared statements.
`apps/api/src/db/client.ts` already passes `prepare: false`, so nothing
else has to change.

For running the stack locally, `docker-compose.yml` enables IPv6 on its
default network instead, so the direct URL works unchanged on a machine
that has IPv6 to Supabase — a laptop usually does. That is a
convenience and not a substitute: the managed host you deploy to
probably has no IPv6 at all, which is what the pooler is for.

---

## Deploying

**API** — any Node 20 host that can run a container (Fly, Railway,
Render). Needs every `api` variable, `NODE_ENV=production`, and the
pooler `DATABASE_URL` above. Avoid free tiers that sleep on idle: a
cold start of roughly a minute lands on whoever opens the link.

**Web** — the nginx image, or `apps/web/dist` on any static host
(Vercel, Netlify, S3+CloudFront). The `VITE_*` values are needed at
**build** time.

**S3** — the browser uploads straight to S3 with a pre-signed URL, so
the bucket needs a CORS rule allowing `PUT` and `GET` from the web
app's origin. That rule lives on the bucket, not in this repo. The IAM
policy the API needs is in `infra/iam/claimflow-api-policy.json`, with
the reasoning for each grant in `infra/iam/README.md`.

**CORS on the API** is `origin: true`, which reflects whatever origin
asks. That is fine for a demo and worth pinning to the web domain for
anything else.

### The demo data is reproducible

```bash
pnpm --filter @claimflow/api db:migrate
pnpm --filter @claimflow/api db:seed        # the brief's three claims
pnpm --filter @claimflow/api db:seed:demo   # six months of history
pnpm --filter @claimflow/api db:verify      # 9 checks, exits non-zero on any failure
```

Those four commands against an empty database produce the demo. Both
seeds refuse to run twice and take `--reset`; running them repeatedly
used to mean two of every insurer and a dashboard counting everything
twice.

`db:verify` exists because every rule in it is one that was broken and
then found by hand: a claim settled the day before it was admitted,
deductions totalling more than the bill they came out of, a pre-auth
form whose lines did not sum to the total it declared, claims carrying
an empty checklist. Finding those at a terminal one query at a time is
a bad way to find out and a worse way to find out twice.

### Migrations

```bash
docker compose run --rm migrate              # apply what is outstanding
docker compose run --rm migrate --status     # say what would happen, change nothing
docker compose run --rm migrate --baseline   # record all as applied, run none
```

or `pnpm --filter @claimflow/api db:migrate` from a checkout, which is
the same code.

**`--baseline` is for a database that already has these applied by
hand.** The demo database is one: all 36 were applied as raw SQL over
months with nothing recording them, so a first run there would try to
create tables that already exist. Baselining writes the record without
executing anything. A fresh database needs the plain command.

`db:migrate` no longer calls `drizzle-kit`. It could not: drizzle
applies what is listed in `meta/_journal.json`, and that journal stops
at `0011` while the directory goes to `0035` — everything from
`0012_claim_preauth_fields` onward, including the pre-auth layouts and
the custom modules, was written and applied as raw SQL without a
journal entry. Pointed at an empty database it built a schema missing
half the tables and reported success.

`src/db/migrate.ts` runs the files the way they have always actually
been run: in filename order, which is numeric because every name is
zero-padded to four digits. One transaction per file, so a failure
leaves nothing half-applied. Applied filenames and their checksums go
in `_claimflow_migrations`, and a file edited after it ran is an error
rather than a silent divergence.

Verified against an empty Postgres: all 36 apply, and the result is
column-for-column identical to the live database — 24 tables, 246
columns, no differences in either direction. Running twice is a no-op.

`drizzle-kit generate` is still how a new migration is authored, but
it diffs against `meta/*_snapshot.json`, and those stop at `0011` too.
Until that is re-baselined it will propose a migration containing 24
migrations' worth of changes. Write new ones by hand, as the last 24
were.

### `DATA_RESIDENCY_ACK`

`assertDataResidency` refuses to boot a production server whose
database or S3 region is outside India, because the DPDP Act 2023
treats patient records as sensitive personal data. On Fargate, a task
has no IPv6, so the API must reach Supabase through the Supavisor
pooler rather than the direct host — and the pooler hostname is the one
place the region is actually visible to this check, so an environment
that routes through it gets checked where one on a direct connection
wouldn't be.

`DATA_RESIDENCY_ACK` is the only way to boot anyway, and it's
deliberately awkward: the value must be a full sentence saying why,
and that sentence is logged at error level on every boot beside the
finding it excuses. There's no flag that just says `true`.

**This is for synthetic records only.** A server holding real patient
data outside India is unlawful whatever this variable says. The log
line exists so that nobody deploying this for real can claim the check
didn't warn them.

### Without an Anthropic key

Everything still runs. Document sorting falls back to filename matching
and labels itself "Matched by filename" rather than claiming a model
read the page. Pre-auth extraction has no fallback — there is no way to
guess an ICD-10 code from a filename — so the button reports that it
needs a key instead of silently finding nothing.
