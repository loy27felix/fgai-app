FROM node:24-slim AS frontend-builder
WORKDIR /build/frontend
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY upstream/frontend/package.json upstream/frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
ARG BUILD_COMMIT
RUN test -n "$BUILD_COMMIT" && printf '%s' "$BUILD_COMMIT" > /build/fg-source-commit
COPY upstream/frontend/ ./
# Upstream fixtures use their original product name; the shipped bundle uses FG.
RUN VITE_BRAND_NAME=ArcReel pnpm check --maxWorkers=1 --testTimeout=20000
ENV VITE_BRAND_NAME="FG FOR DIRECTOR"
RUN FG_DIRECTOR_BASE_PATH=/fg-director/ pnpm build

FROM fg-six-arcreel:upstream-9aaf4413
USER root
RUN groupadd -g 1000 fg && useradd -u 1000 -g 1000 -m fg && mkdir -p /state /workspace && chown fg:fg /state /workspace
COPY upstream/ /app/
RUN uv sync --locked --no-dev --no-install-project
COPY deploy/entry.py /app/fg-entry.py
COPY deploy/company_cost.py /app/company_cost.py
COPY deploy/company_request.py /app/company_request.py
COPY --from=frontend-builder /build/frontend/dist/ /app/frontend/dist/
COPY SOURCE.md /app/FG-SOURCE.md
COPY upstream/ /app/fg-source/upstream/
COPY deploy/ /app/fg-source/deploy/
COPY SOURCE.md /app/fg-source/SOURCE.md
RUN tar -czf /app/fg-source.tar.gz -C /app/fg-source .
ENV HOME=/state/home ARCREEL_DATA_DIR=/workspace DATABASE_URL=sqlite+aiosqlite:////state/arcreel.db AUTH_ENABLED=false
USER fg
CMD ["/app/.venv/bin/python", "/app/fg-entry.py"]
