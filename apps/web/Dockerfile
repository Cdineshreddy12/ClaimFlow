# syntax=docker/dockerfile:1
#
# The React SPA, served by nginx.
#
# Built from the repository root:
#
#     docker build -f apps/web/Dockerfile \
#       --build-arg VITE_API_URL=https://api.example.com \
#       --build-arg VITE_SUPABASE_URL=https://xyz.supabase.co \
#       --build-arg VITE_SUPABASE_ANON_KEY=... \
#       -t claimflow-web .
#
# Those are build arguments and not environment variables because Vite
# inlines them into the bundle. Nothing reads them at run time, so a
# container started with a different VITE_API_URL still calls the old
# one — changing where this talks to means rebuilding, not restarting.
#
# Only the anon key belongs here. It is public by design (the browser
# sends it on every request and Supabase expects that); the service
# role key is not, and the web app never needs it.

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app


FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile


FROM deps AS build
ARG VITE_API_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_API_URL=$VITE_API_URL \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
COPY . .
RUN pnpm --filter @claimflow/web build


FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

# 8080 rather than 80, so nginx needs no privileged port and the
# container can run unprivileged on hosts that insist on it.
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
