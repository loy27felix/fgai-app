const DEFAULT_CONCURRENCY = 32;
const MAX_CONCURRENCY = 32;
const POLL_INTERVAL_MS = 5_000;

function workerConcurrency() {
  const configured = Number.parseInt(process.env.FG_VIDEO_WORKER_CONCURRENCY || "", 10);
  if (!Number.isInteger(configured) || configured < 1) return DEFAULT_CONCURRENCY;
  return Math.min(configured, MAX_CONCURRENCY);
}

function delay(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function consume(slot, secret) {
  for (;;) {
    try {
      const response = await fetch("http://app:3000/api/internal/video-task-worker", {
        method: "POST",
        headers: { "x-fg-observability-secret": secret },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error(JSON.stringify({ event: "video_worker_request_failed", slot, status: response.status }));
      } else if (body.processed) {
        console.log(JSON.stringify({ event: "video_worker_task_processed", slot, taskId: body.taskId || null }));
      }
    } catch (error) {
      console.error(JSON.stringify({
        event: "video_worker_transport_failed",
        slot,
        message: error instanceof Error ? error.message : "unknown worker transport error",
      }));
    }
    await delay(POLL_INTERVAL_MS);
  }
}

const secret = process.env.FG_OBSERVABILITY_SECRET || process.env.SESSION_SECRET || "";
if (!secret) throw new Error("video worker secret is not configured");

const concurrency = workerConcurrency();
// Each slot owns one long-running provider submission so another user's task can start immediately.
// 每个槽位独立承载一个长时间 Provider 提交，避免单个用户阻塞其他用户。
await Promise.all(Array.from({ length: concurrency }, (_, slot) => consume(slot + 1, secret)));
