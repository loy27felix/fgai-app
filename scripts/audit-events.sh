#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-168}"

if [[ "$MODE" != "all" && ! "$MODE" =~ ^[0-9]+$ ]]; then
  echo "Usage: $0 [hours|all]" >&2
  exit 2
fi

if [[ "$MODE" == "all" ]]; then
  FILTER="true"
else
  FILTER="occurred_at >= now() - make_interval(hours => ${MODE})"
fi

cd "$PROJECT_ROOT"
docker compose --env-file .env.docker exec -T postgres sh -c \
  "psql -X -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -P pager=off -c \"select occurred_at, trace_id, actor_id, workspace_id, feature, action, resource_type, resource_id, stage, outcome, status_before, status_after, duration_ms, parameters, data, error, metadata from audit_events where ${FILTER} order by occurred_at asc;\""
