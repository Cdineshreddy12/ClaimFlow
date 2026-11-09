# syntax=docker/dockerfile:1
#
# The Fastify API.
#
# Built from the repository root, not this directory — it is one package
# in a pnpm workspace and the lockfile that pins it lives at the top:
#
#     docker build -f apps/api/Dockerfile -t claimflow-api .
#
# The runtime stage carries the bundle and production dependencies and
# nothing else: no pnpm, no TypeScript, no source, no dev tooling.

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app


# Dependencies on their own layer, so editing a source file does not
# re-resolve the whole workspace. Only the manifests are copied here;
# the lockfile describes every package, so each one's package.json has
# to be present for --frozen-lockfile to agree with it.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile


FROM deps AS build
COPY . .
# tsup, not tsc: the emitted JS has to stop importing the contracts
# package by name, because that name resolves to TypeScript source.
# See apps/api/tsup.config.ts.
RUN pnpm --filter @claimflow/api build
# A self-contained node_modules for the API alone, with devDependencies
# left out and the workspace links resolved into real directories.
RUN pnpm --filter @claimflow/api deploy --prod /out


FROM base AS runtime
ENV NODE_ENV=production
# Fastify already binds 0.0.0.0; this only sets the port it listens on.
ENV PORT=4200

# Not root. The process reads its configuration from the environment
# and writes nothing to disk, so it has no business owning the files it
# runs.
USER node

COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
# Carried so the image can migrate a database it is pointed at. See the
# note in deployment.md about which runner actually applies them.
COPY --from=build --chown=node:node /app/apps/api/src/db/migrations ./migrations

EXPOSE 4200

# Hits the route the app already serves, so an orchestrator's idea of
# healthy is the same as the app's.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4200)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
