FROM golang:1.25-bookworm AS go
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-certifi make g++ ffmpeg curl fonts-noto-cjk ca-certificates git && rm -rf /var/lib/apt/lists/*
COPY --from=go /usr/local/go /usr/local/go
ENV PATH=/usr/local/go/bin:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY upstream/ ./
RUN pnpm install --frozen-lockfile
RUN pnpm krillinai:build && pnpm --filter @opencreator/daemon build && pnpm templates:compile
RUN pnpm --filter @opencreator/daemon --filter @opencreator/web test -- --maxWorkers=2 --minWorkers=1
ENV OPENCREATOR_WEB_BASE=/creator-static/ VITE_FG_MANAGED=1
RUN pnpm --filter @opencreator/web build
RUN npm install -g @openai/codex@0.149.0 && codex --version
COPY deploy/entry.mjs /app/fg-entry.mjs
COPY deploy/trash.mjs /app/fg-trash.mjs
COPY deploy/company-media.mjs /app/company-media.mjs
COPY deploy/company-media-preload.mjs /app/company-media-preload.mjs
COPY deploy/company-config.mjs /app/company-config.mjs
FROM build AS runtime
ENV OPENCREATOR_HOME=/state/opencreator OPENCREATOR_DATA_DIR=/state/opencreator/data OPENCREATOR_CODEX_HOME=/state/codex OPENCREATOR_DEFAULT_CWD=/workspace OPENCREATOR_DEFAULT_PROJECT_ROOT=/workspace OPENCREATOR_CREATOR_DIR=/workspace/creator OPENCREATOR_CODEX_BIN=/usr/local/bin/codex OPENCREATOR_CREATOR_RUNTIME_ROOT=/app/.runtime/build/krillinai/linux-arm64 OPENCREATOR_PRESET_CATALOG_ROOT=/app/.runtime/generated/creator-presets
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip && rm -rf /var/lib/apt/lists/*
RUN pip3 install --break-system-packages --no-cache-dir 'yt-dlp[default]==2026.8.19'
COPY deploy/package-media-runtime.mjs /app/package-media-runtime.mjs
RUN node /app/package-media-runtime.mjs
RUN printf '%s\n' '--js-runtimes node' > /etc/yt-dlp.conf
EXPOSE 8060
CMD ["node", "/app/fg-entry.mjs"]
FROM nginx:stable-alpine AS web
COPY --from=build /app/apps/web/dist/ /usr/share/nginx/html/
