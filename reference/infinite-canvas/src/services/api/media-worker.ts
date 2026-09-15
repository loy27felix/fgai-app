import { requestJson } from "@/lib/creator/image-client";
import type { MediaJobStatus, MediaOperation, TargetResolution, WorkerBackend, WorkerCapability } from "@/types/media-worker";

export type MediaWorkerJob = {
    id: string;
    user_id: string;
    workspace_id: string;
    operation: MediaOperation;
    status: MediaJobStatus;
    source_asset_id: string;
    mask_asset_id: string | null;
    output_asset_id: string | null;
    request: Record<string, unknown>;
    output: Record<string, unknown>;
    worker_id: string | null;
    attempt_count: number;
    progress: string | number;
    phase: string | null;
    error_code: string | null;
    error_message: string | null;
    created_at: string;
    updated_at: string;
    started_at: string | null;
    completed_at: string | null;
};

export type MediaWorkerSummary = {
    id: string;
    name: string;
    platform: string;
    architecture: string;
    capabilities: WorkerCapability;
    status: "online" | "offline" | "revoked";
    last_seen_at: string | null;
    created_at: string;
};

export type MediaJobCreateInput = {
    workspaceId: string;
    operation: MediaOperation;
    sourceAssetId: string;
    maskAssetId?: string | null;
    targetResolution?: TargetResolution | null;
    modelProfile: string;
    idempotencyKey: string;
};

export function getCreatorWorkspace() {
    return requestJson<{ workspace: { id: string } }>("/api/creator/workspace", { method: "GET" });
}

export function listMediaWorkers() {
    return requestJson<{ enabled: boolean; workers: MediaWorkerSummary[] }>("/api/creator/workers", { method: "GET" });
}

export function createMediaJob(input: MediaJobCreateInput) {
    return requestJson<{ job: MediaWorkerJob; replayed: boolean }>("/api/creator/media/jobs", {
        method: "POST",
        body: JSON.stringify(input),
    });
}

export function getMediaJob(jobId: string) {
    return requestJson<{ job: MediaWorkerJob }>(`/api/creator/media/jobs/${encodeURIComponent(jobId)}`, { method: "GET" });
}

export function cancelMediaJob(jobId: string) {
    return requestJson<{ job: MediaWorkerJob }>(`/api/creator/media/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
}

export function mediaWorkerBackendLabel(backend: WorkerBackend) {
    return backend === "cuda" ? "NVIDIA CUDA" : backend === "mps" ? "Apple Metal (MPS)" : "CPU";
}
