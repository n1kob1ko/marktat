# syntax=docker/dockerfile:1.7
# MarktAT-Web (Next.js) für den Online-Betrieb. Build-Kontext: Repo-Wurzel.
# Öffentliche Adressen und der Anon-Key werden beim Build fest eingebaut (NEXT_PUBLIC_*, CSP) –
# deshalb je Umgebung ein eigenes Image:
#   docker build -f apps/web/Dockerfile --build-arg WEB_URL=https://… --build-arg API_URL=https://… \
#     --build-arg SUPABASE_URL=https://… --build-arg SUPABASE_ANON_KEY=… -t marktat-web .
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true COREPACK_HOME=/corepack
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --filter @marktat/web...
COPY packages/shared packages/shared
COPY packages/ui packages/ui
COPY apps/web apps/web
ARG WEB_URL
ARG API_URL
ARG SUPABASE_URL
ARG SUPABASE_ANON_KEY
ARG STORAGE_DRIVER=r2
ARG R2_ACCOUNT_ID=
ARG R2_JURISDICTION=default
ARG R2_ENDPOINT=
# Suchmaschinen erst nach dem offiziellen Start (siehe docs/betrieb.md)
ARG ALLOW_INDEXING=false
ENV NODE_ENV=production NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1 \
  WEB_URL=$WEB_URL API_URL=$API_URL SUPABASE_URL=$SUPABASE_URL SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY \
  STORAGE_DRIVER=$STORAGE_DRIVER R2_ACCOUNT_ID=$R2_ACCOUNT_ID R2_JURISDICTION=$R2_JURISDICTION R2_ENDPOINT=$R2_ENDPOINT \
  ALLOW_INDEXING=$ALLOW_INDEXING
RUN test -n "$WEB_URL" && test -n "$API_URL" && test -n "$SUPABASE_URL" && test -n "$SUPABASE_ANON_KEY" \
  || (echo "WEB_URL, API_URL, SUPABASE_URL und SUPABASE_ANON_KEY als --build-arg angeben" && exit 1)
RUN pnpm --filter @marktat/shared build && pnpm --filter @marktat/web build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:3000/impressum').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
