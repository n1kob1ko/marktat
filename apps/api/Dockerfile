# syntax=docker/dockerfile:1.7
# MarktAT-API (NestJS) für den Online-Betrieb. Build-Kontext: Repo-Wurzel.
#   docker build -f apps/api/Dockerfile -t marktat-api .
# Das Image enthält auch die Werkzeuge für Migrationen und Verwaltung (prisma, tsx), z. B.
#   docker compose run --rm api pnpm db:migrate
ARG NODE_IMAGE=node:22-bookworm-slim
# OpenSSL braucht die Migrations-Engine von Prisma. Beim Build vorhanden, damit Prisma die passende Engine gleich
# mitinstalliert (sonst lädt `prisma migrate deploy` sie auf dem Server aus dem Internet nach).
FROM ${NODE_IMAGE} AS os
RUN command -v openssl > /dev/null || (apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*)

FROM os AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true COREPACK_HOME=/corepack
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --filter @marktat/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @marktat/shared build && pnpm --filter @marktat/api build

FROM os AS runtime
# pnpm liegt fest im Image (COREPACK_HOME, für alle lesbar): Verwaltungsbefehle laufen ohne Download als Benutzer node
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production COREPACK_HOME=/corepack COREPACK_ENABLE_NETWORK=0
RUN corepack enable && COREPACK_ENABLE_NETWORK=1 corepack prepare pnpm@10.28.0 --activate && chmod -R a+rX /corepack
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
