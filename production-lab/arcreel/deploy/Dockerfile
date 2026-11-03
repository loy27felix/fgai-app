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
COPY deploy/company_recycle.py /app/company_recycle.py
COPY deploy/support_evidence.py /app/support_evidence.py
ARG BUILD_COMMIT
ARG BUILD_TIME
ARG BUILD_ENVIRONMENT
ARG BUILD_DIRTY
RUN BUILD_COMMIT="$BUILD_COMMIT" BUILD_TIME="$BUILD_TIME" BUILD_ENVIRONMENT="$BUILD_ENVIRONMENT" BUILD_DIRTY="$BUILD_DIRTY" /app/.venv/bin/python -c 'import datetime,json,os,pathlib,tomllib; p=tomllib.loads(pathlib.Path("/app/pyproject.toml").read_text()); pathlib.Path("/app/arcreel-build.json").write_text(json.dumps({"commit":os.getenv("BUILD_COMMIT") or "unknown","version":p["project"]["version"],"buildTime":os.getenv("BUILD_TIME") or datetime.datetime.now(datetime.UTC).isoformat(),"environment":os.getenv("BUILD_ENVIRONMENT") or "unknown","dirty":os.getenv("BUILD_DIRTY") or "unknown"}))'
RUN chmod 0644 /app/fg-entry.py /app/company_cost.py /app/company_request.py /app/company_recycle.py /app/support_evidence.py
COPY --from=frontend-builder /build/frontend/dist/ /app/frontend/dist/
COPY SOURCE.md /app/FG-SOURCE.md
COPY upstream/ /app/fg-source/upstream/
COPY deploy/ /app/fg-source/deploy/
COPY SOURCE.md /app/fg-source/SOURCE.md
RUN tar -czf /app/fg-source.tar.gz -C /app/fg-source .
ENV HOME=/state/home ARCREEL_DATA_DIR=/workspace DATABASE_URL=sqlite+aiosqlite:////state/arcreel.db AUTH_ENABLED=false
USER fg
HEALTHCHECK --start-period=300s --interval=30s --timeout=5s --retries=3 CMD curl -f http://localhost:1241/health || exit 1
RUN /app/.venv/bin/python -c "from pathlib import Path; compile(Path('/app/fg-entry.py').read_text(), 'fg-entry', 'exec'); import company_recycle; company_recycle.install()"
CMD ["/app/.venv/bin/python", "/app/fg-entry.py"]
