# ICPD v4 API (NestJS). Build from the repo root:
#   docker build -f infra/docker/api.Dockerfile -t icpd-api .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @icpd/api... --filter @icpd/shared
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @icpd/shared build && pnpm --filter @icpd/api build

FROM base AS runtime
# pg_dump 16 for the weekly backup job (the server is PostgreSQL 16).
RUN apt-get update && apt-get install -y --no-install-recommends curl gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
 && apt-get purge -y gnupg && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=UTC PORT=4000
COPY --from=build /app /app
WORKDIR /app/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
