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

V8 heap and Next worker limits alone did not prevent the second OOM. Release builds now use a docker-container BuildKit worker capped at 3 GiB memory and 3 GiB combined memory/swap (no extra swap), with two concurrent build operations. Admission checks reject missing or unbounded limits instead of falling back to the shared, unbounded driver.

Validation: four mocked recovery cases, six mocked builder admission cases, and an actual bounded scratch-image build/load. The active builder container resource settings were inspected directly. Tests do not induce OOM or stop real production workers.
