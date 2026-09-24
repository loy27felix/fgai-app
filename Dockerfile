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
# Alpine mirror downloads can be truncated transiently on the deployment host.
# 部署主机的 Alpine 镜像下载可能短暂中断，有限重试后仍失败才中止构建。
RUN set -eu; \
    for attempt in 1 2 3; do \
      if apk add --no-cache ffmpeg; then break; fi; \
      [ "$attempt" -lt 3 ] || exit 1; \
      sleep 3; \
    done; \
    addgroup -S nextjs; \
    adduser -S nextjs -G nextjs
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
# The startup migration script runs outside Next's output-file tracing, so it
# needs the application's PostgreSQL driver and its transitive dependencies.
COPY --from=deps --chown=nextjs:nextjs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/scripts/local-db-migrate.mjs ./scripts/local-db-migrate.mjs
COPY --from=builder --chown=nextjs:nextjs /app/scripts/production-lab-migrate.mjs ./scripts/production-lab-migrate.mjs
COPY --from=builder --chown=nextjs:nextjs /app/production-lab/migrations/005-media-queue-and-assets.sql ./production-lab/migrations/005-media-queue-and-assets.sql
COPY --exclude=001-local.sql --from=builder --chown=nextjs:nextjs /app/docker/initdb/ ./docker/initdb/
# Keep the durable creator-session upgrade explicit for contract checks and image audits.
# 为已有本地 volume 保留显式升级文件，便于构建审计与启动迁移校验。
COPY --from=builder --chown=nextjs:nextjs /app/docker/initdb/002-local-upgrade.sql ./docker/initdb/002-local-upgrade.sql

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
