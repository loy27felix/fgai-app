#!/usr/bin/env bash

# Release builds share the VM with live provider workers. Fail closed rather
# than fall back to the unbounded Docker driver when isolation is unavailable.
FG_BUILD_BUILDER="${FG_BUILD_BUILDER:-fg-studio-limited}"

ensure_build_resource_limit() {
  local limits memory swap
  [[ "$FG_BUILD_BUILDER" =~ ^[a-z0-9][a-z0-9-]+$ ]] || return 1
  if ! docker buildx inspect "$FG_BUILD_BUILDER" >/dev/null 2>&1; then
    docker buildx create --name "$FG_BUILD_BUILDER" --node "${FG_BUILD_BUILDER}0" \
      --driver docker-container \
      --driver-opt image=docker.m.daocloud.io/moby/buildkit:buildx-stable-1 \
      --driver-opt memory=3g --driver-opt memory-swap=3g --driver-opt default-load=true \
      --buildkitd-config "$PROJECT_ROOT/docker/buildkitd.toml" >/dev/null || return 1
  fi
  docker buildx inspect --bootstrap "$FG_BUILD_BUILDER" >/dev/null || return 1
  limits="$(docker inspect --format '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}}' "buildx_buildkit_${FG_BUILD_BUILDER}0")" || return 1
  read -r memory swap <<< "$limits"
  [[ "$memory" =~ ^[0-9]+$ && "$swap" =~ ^[0-9]+$ ]] || return 1
  (( memory > 0 && memory <= 3221225472 && swap > 0 && swap <= memory ))
}
