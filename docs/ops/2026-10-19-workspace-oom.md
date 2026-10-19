# Workspace API interruption on 2026-10-19

The canvas backend exited with status 137 and Docker OOMKilled=true at 15:12:12 Asia/Shanghai. The outer platform and databases remained healthy, while the canvas web proxy returned 502. Native API sessions therefore displayed the workspace-connection recovery screen.

An earlier OOM exit occurred at 14:35:23. Both exits overlapped automatic Next release builds in the shared Docker VM (about 7.75 GiB usable memory on a 16 GiB Mac). The OOM victim is confirmed; no kernel allocator trace was captured, so timing alone does not identify the precise allocation that exhausted memory.

## Immediate recovery

- Verified the NAS readiness marker, then started the existing backend container with its original image and mounts.
- Rechecked the native public API and authenticated project/catalog access.
- Did not stop or unload production LaunchAgents, restart databases, delete user media, or resubmit provider tasks.

## Recovery deadlock

The maintenance worker probed the stopped backend, interpreted it as stale storage, and deferred storage recreation while active task records existed. Those tasks could not finish while the backend stayed stopped.

The new branch starts only an OOM-exited backend after the NAS probe passes. Healthy workers and deliberately stopped services are preserved. Real NAS rebinds retain the existing idle-task guard.

## Build containment

V8 heap and Next worker limits alone did not prevent the second OOM. Release builds now use a docker-container BuildKit worker capped at 3 GiB memory and 3 GiB combined memory/swap (no extra swap). The worker uses a 256 MiB Go memory target and one concurrent build operation. Compose resolves contexts, image tags and version arguments, then Bake enforces 2560 MiB memory and combined memory/swap limits for each RUN step. Admission checks reject missing or unbounded daemon limits instead of falling back to the shared driver.

Next compilation uses a 1536 MiB V8 heap, two Rayon threads and one page worker. The build additionally checks BUILD_ID, the standalone entry point and static output: a compiler worker that exits without usable output cannot produce a release image.

The initial bounded build did not finish, and the existing healthy app remained in place. Its failure triggered unnecessary rollback builds. After verifying that the running container and HTTP version still matched the original a47f7dc20864 release, the failed-deployment record was marked rollback-completed under the normal deployment lock. No production service was stopped for this correction.

An isolated full compilation also ran out of memory while the backend remained healthy. At idle, the shared VM exposed only about 1.7 GiB MemAvailable. A new admission check requires 3.5 GiB MemAvailable before release compilation; low or unreadable headroom defers the release without recording it as a failed build or changing the running app. A full app image has not been validated with this configuration and must not be reported as released.

Validation: four mocked recovery cases, twelve mocked builder admission/build cases (including low/unreadable headroom), an actual bounded scratch-image build/load, and Bake resource argument resolution. The active builder container resource settings were inspected directly. Tests do not deliberately induce OOM or stop real production workers.
