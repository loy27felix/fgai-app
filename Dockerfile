FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
ARG APP_DEPLOYMENT_VERSION=dev
ENV NEXT_TELEMETRY_DISABLED=1
ENV APP_DEPLOYMENT_VERSION=${APP_DEPLOYMENT_VERSION}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

FROM node:20-alpine AS runner
WORKDIR /app
ARG APP_DEPLOYMENT_VERSION=dev
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV APP_DEPLOYMENT_VERSION=${APP_DEPLOYMENT_VERSION}
RUN apk add --no-cache ffmpeg && addgroup -S nextjs && adduser -S nextjs -G nextjs
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
# The startup migration script runs outside Next's output-file tracing, so it
# needs the application's PostgreSQL driver and its transitive dependencies.
COPY --from=deps --chown=nextjs:nextjs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/scripts/local-db-migrate.mjs ./scripts/local-db-migrate.mjs
COPY --from=builder --chown=nextjs:nextjs /app/docker/initdb/002-local-upgrade.sql ./docker/initdb/002-local-upgrade.sql
COPY --from=builder --chown=nextjs:nextjs /app/docker/initdb/003-local-observability.sql ./docker/initdb/003-local-observability.sql
COPY --from=builder --chown=nextjs:nextjs /app/docker/initdb/005-observability-reporting.sql ./docker/initdb/005-observability-reporting.sql
COPY --from=builder --chown=nextjs:nextjs /app/docker/initdb/006-observability-log-stream.sql ./docker/initdb/006-observability-log-stream.sql
COPY --from=builder --chown=nextjs:nextjs /app/docker/initdb/004-company-productions.sql ./docker/initdb/004-company-productions.sql
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
