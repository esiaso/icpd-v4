# ICPD v4 web (Next.js, standalone output). Build from the repo root:
#   docker build -f infra/docker/web.Dockerfile --build-arg API_URL=http://api:4000 -t icpd-web .
# API_URL and NEXT_PUBLIC_* values are baked in at build time.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
ARG API_URL=http://api:4000
ARG NEXT_PUBLIC_LOGO_URL=/brand/icpd-logo.png
ARG NEXT_PUBLIC_REGULATOR_LOGO_URL=/brand/kmpdc-logo.png
ARG NEXT_PUBLIC_CONTACT_PHONE=
ARG NEXT_PUBLIC_CONTACT_EMAIL=
ARG NEXT_PUBLIC_RECAPTCHA_SITE_KEY=
ENV API_URL=$API_URL NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_LOGO_URL=$NEXT_PUBLIC_LOGO_URL NEXT_PUBLIC_REGULATOR_LOGO_URL=$NEXT_PUBLIC_REGULATOR_LOGO_URL \
    NEXT_PUBLIC_CONTACT_PHONE=$NEXT_PUBLIC_CONTACT_PHONE NEXT_PUBLIC_CONTACT_EMAIL=$NEXT_PUBLIC_CONTACT_EMAIL \
    NEXT_PUBLIC_RECAPTCHA_SITE_KEY=$NEXT_PUBLIC_RECAPTCHA_SITE_KEY
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @icpd/web... --filter @icpd/shared
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @icpd/shared build && pnpm --filter @icpd/web build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3100 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3100
CMD ["node", "apps/web/server.js"]
