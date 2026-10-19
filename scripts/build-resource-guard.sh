#!/usr/bin/env bash

# Release builds share the VM with live provider workers. Fail closed rather
# than fall back to the unbounded Docker driver when isolation is unavailable.
FG_BUILD_BUILDER="${FG_BUILD_BUILDER:-fg-studio-safe-v2}"

ensure_build_resource_limit() {
  local limits memory swap
  [[ "$FG_BUILD_BUILDER" =~ ^[a-z0-9][a-z0-9-]+$ ]] || return 1
  if ! docker buildx inspect "$FG_BUILD_BUILDER" >/dev/null 2>&1; then
    docker buildx create --name "$FG_BUILD_BUILDER" --node "${FG_BUILD_BUILDER}0" \
      --driver docker-container \
      --driver-opt image=docker.m.daocloud.io/moby/buildkit:buildx-stable-1 \
      --driver-opt memory=3g --driver-opt memory-swap=3g \
      --driver-opt env.GOMEMLIMIT=256MiB --driver-opt default-load=true \
      --buildkitd-config "$PROJECT_ROOT/docker/buildkitd.toml" >/dev/null || return 1
  fi
  docker buildx inspect --bootstrap "$FG_BUILD_BUILDER" >/dev/null || return 1
  limits="$(docker inspect --format '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}}' "buildx_buildkit_${FG_BUILD_BUILDER}0")" || return 1
  read -r memory swap <<< "$limits"
  [[ "$memory" =~ ^[0-9]+$ && "$swap" =~ ^[0-9]+$ ]] || return 1
  (( memory > 0 && memory <= 3221225472 && swap > 0 && swap <= memory )) || return 1
  build_memory_headroom_available
}

build_memory_headroom_available() {
  local available
  available="$(docker exec "buildx_buildkit_${FG_BUILD_BUILDER}0" sh -c 'awk '\''/^MemAvailable:/ { print $2 }'\'' /proc/meminfo')" || return 1
  [[ "$available" =~ ^[0-9]+$ ]] || return 1
  # Leave space for the 2.5 GiB compiler, builder overhead and live traffic.
  (( available >= 3670016 ))
}

# Compose resolves the real service context, tags and deployment arguments;
# Bake adds limits for RUN processes, not just for the BuildKit daemon.
bounded_compose_build() (
  local bake_file
  bake_file="$(mktemp "$BUILD_LOG_ROOT/.bounded-bake.XXXXXX")" || return 1
  trap 'rm -f "$bake_file"' EXIT
  compose build --print --build-arg "APP_DEPLOYMENT_VERSION=$APP_DEPLOYMENT_VERSION" "$@" > "$bake_file" || return 1
  docker buildx bake --builder "$FG_BUILD_BUILDER" --file "$bake_file" \
    --set '*.resources.memory=2560m' --set '*.resources.memory-swap=2560m' \
    --load "$@"
)
