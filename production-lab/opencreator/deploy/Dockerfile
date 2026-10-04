FROM golang:1.25-bookworm AS go
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ffmpeg ca-certificates git && rm -rf /var/lib/apt/lists/*
COPY --from=go /usr/local/go /usr/local/go
ENV PATH=/usr/local/go/bin:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY upstream/ ./
RUN pnpm install --frozen-lockfile
RUN pnpm krillinai:build && pnpm --filter @opencreator/daemon build && pnpm templates:compile
ENV OPENCREATOR_WEB_BASE=/creator-static/ VITE_FG_MANAGED=1
RUN pnpm --filter @opencreator/web build
RUN npm install -g @openai/codex@0.149.0 && codex --version
COPY deploy/entry.mjs /app/fg-entry.mjs
FROM build AS runtime
ENV OPENCREATOR_HOME=/state/opencreator OPENCREATOR_DATA_DIR=/state/opencreator/data OPENCREATOR_CODEX_HOME=/state/codex OPENCREATOR_DEFAULT_CWD=/workspace OPENCREATOR_DEFAULT_PROJECT_ROOT=/workspace OPENCREATOR_CREATOR_DIR=/workspace/creator OPENCREATOR_CODEX_BIN=/usr/local/bin/codex OPENCREATOR_CREATOR_RUNTIME_ROOT=/app/.runtime/build/krillinai/linux-arm64 OPENCREATOR_PRESET_CATALOG_ROOT=/app/.runtime/generated/creator-presets
EXPOSE 8060
CMD ["node", "/app/fg-entry.mjs"]
FROM nginx:stable-alpine AS web
COPY --from=build /app/apps/web/dist/ /usr/share/nginx/html/
