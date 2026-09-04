"use client";

import { useEffect } from "react";

type ClientErrorReporterProps = {
  deploymentVersion: string;
  systemVersion: string;
};

type BodyEncoding = "json" | "text" | "binary" | "empty" | "unavailable";
type BodySnapshot = {
  encoding: BodyEncoding;
  body?: unknown;
  bytes?: number;
  truncated?: boolean;
};

const EXCHANGE_ENDPOINT = "/api/observability/client-exchanges";
// Keep each captured body below the browser keepalive budget so telemetry can finish without blocking navigation.
// 将单个采集体控制在浏览器 keepalive 限额内，确保观测上报不会阻塞页面跳转。
const MAX_CAPTURE_BYTES = 16 * 1024;
const TRACE_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const SENSITIVE_HEADER = /^(authorization|cookie|set-cookie|proxy-authorization)$/i;

function text(value: unknown, limit: number) {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function errorDetails(value: unknown) {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (typeof value === "string") return { name: "UnhandledRejection", message: value };
  try { return { name: "UnhandledRejection", message: JSON.stringify(value) }; } catch { return { name: "UnhandledRejection", message: String(value) }; }
}

function eventId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function headerSnapshot(headers: Headers) {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = SENSITIVE_HEADER.test(key) ? "[redacted]" : text(value, 2_000);
  });
  return result;
}

function isTextPayload(contentType: string) {
  return !contentType || /json|text\/|xml|javascript|urlencoded|form-data/i.test(contentType);
}

async function readBodyText(source: Request | Response) {
  if (!source.body) return { value: "", bytes: 0, truncated: false };
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value = chunk.value;
      const remaining = MAX_CAPTURE_BYTES - totalBytes;
      if (value.byteLength > remaining) {
        if (remaining > 0) chunks.push(value.slice(0, remaining));
        totalBytes += Math.max(0, remaining);
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { value: new TextDecoder().decode(merged), bytes: totalBytes, truncated };
}

async function bodySnapshot(source: Request | Response, contentType: string | null): Promise<BodySnapshot> {
  if (!source.body) return { encoding: "empty", bytes: 0 };
  if (!isTextPayload(contentType || "")) return { encoding: "binary" };
  try {
    const body = await readBodyText(source);
    if (!body.value) return { encoding: "empty", bytes: body.bytes, truncated: body.truncated };
    if (/json/i.test(contentType || "")) {
      try {
        return { encoding: "json", body: JSON.parse(body.value), bytes: body.bytes, truncated: body.truncated };
      } catch {
        // Preserve malformed JSON as text so the original wire payload remains diagnosable.
        // JSON 解析失败时保留原始文本，确保线上异常仍可溯源。
      }
    }
    return { encoding: "text", body: body.value, bytes: body.bytes, truncated: body.truncated };
  } catch {
    return { encoding: "unavailable" };
  }
}

export default function ClientErrorReporter({ deploymentVersion, systemVersion }: ClientErrorReporterProps) {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    const report = (input: Record<string, unknown>) => {
      try {
        const body = JSON.stringify({
          ...input,
          route: text(input.route || window.location.pathname, 240),
          deploymentVersion,
          systemVersion,
          eventId: eventId(),
        });
        void originalFetch("/api/observability/client-errors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body,
          keepalive: true,
          signal: AbortSignal.timeout(3_000),
        }).catch(() => undefined);
      } catch {
        // Diagnostics must remain best-effort and never change the original browser event.
        // 诊断上报只能尽力而为，不能改变原始浏览器事件的行为。
      }
    };

    const reportExchange = (input: Record<string, unknown>) => {
      try {
        const body = JSON.stringify({
          ...input,
          pageRoute: window.location.pathname,
          deploymentVersion,
          systemVersion,
          eventId: eventId(),
        });
        const exchangeTraceId = typeof input.traceId === "string" ? input.traceId : "";
        void originalFetch(EXCHANGE_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(exchangeTraceId ? { "x-fg-trace-id": exchangeTraceId } : {}),
          },
          credentials: "include",
          body,
          keepalive: true,
          signal: AbortSignal.timeout(3_000),
        }).catch(() => undefined);
      } catch {
        // Exchange telemetry must remain invisible to the business request.
        // 请求交换观测必须对业务请求完全无感。
      }
    };

    const onError = (event: ErrorEvent) => {
      const details = errorDetails(event.error || event.message);
      report({ name: text(details.name, 160) || "Error", message: text(details.message, 1_000), stack: text(details.stack, 2_000), impact: "unknown" });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const details = errorDetails(event.reason);
      report({ name: text(details.name, 160) || "UnhandledRejection", message: text(details.message, 1_000), stack: text(details.stack, 2_000), impact: "unknown" });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    const wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let requestUrl: URL | null = null;
      try {
        requestUrl = typeof input === "string" || input instanceof URL ? new URL(String(input), window.location.origin) : new URL(input.url, window.location.origin);
      } catch {
        // Observability must never change the behavior of an unusual fetch input.
        // 无法解析请求地址时直接透传，观测逻辑不能改变原始 fetch 行为。
      }
      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      const shouldCaptureExchange = Boolean(
        requestUrl
        && requestUrl.origin === window.location.origin
        && requestUrl.pathname.startsWith("/api/")
        && !requestUrl.pathname.startsWith("/api/observability/"),
      );
      if (!shouldCaptureExchange) {
        try {
          const response = await originalFetch(input, init);
          const shouldReportResponse = requestUrl
            && requestUrl.pathname.startsWith("/api/")
            && requestUrl.pathname !== "/api/observability/client-errors"
            && (response.status >= 500 || response.status === 429);
          if (!response.ok && shouldReportResponse && requestUrl) {
            report({ name: "ApiResponseError", message: `API 请求失败（HTTP ${response.status}）`, apiPath: requestUrl.pathname, method, httpStatus: response.status, traceId: response.headers.get("x-fg-trace-id") || undefined, requestId: response.headers.get("x-request-id") || undefined, impact: response.status >= 500 ? "blocked" : "degraded" });
          }
          return response;
        } catch (error) {
          if (requestUrl && requestUrl.pathname.startsWith("/api/") && requestUrl.pathname !== "/api/observability/client-errors") {
            const details = errorDetails(error);
            report({ name: text(details.name, 160) || "NetworkError", message: text(details.message, 1_000), stack: text(details.stack, 2_000), apiPath: requestUrl.pathname, method, impact: "degraded" });
          }
          throw error;
        }
      }

      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
      const traceId = headers.get("x-fg-trace-id") && TRACE_ID.test(headers.get("x-fg-trace-id") || "")
        ? headers.get("x-fg-trace-id") as string
        : eventId();
      headers.set("x-fg-trace-id", traceId);
      let request: Request;
      try {
        request = new Request(input, { ...init, headers });
      } catch {
        // Keep unusual RequestInit combinations on the native path.
        // 非标准 RequestInit 组合直接走原生路径，观测不能改变其行为。
        return originalFetch(input, init);
      }
      const exchangeUrl = new URL(request.url, window.location.origin);
      const requestSnapshot = (() => {
        try {
          return bodySnapshot(request.clone(), request.headers.get("content-type"));
        } catch {
          return Promise.resolve<BodySnapshot>({ encoding: "unavailable" });
        }
      })();
      const startedAt = Date.now();
      try {
        const response = await originalFetch(request);
        const responseSnapshot = (() => {
          try {
            return bodySnapshot(response.clone(), response.headers.get("content-type"));
          } catch {
            return Promise.resolve<BodySnapshot>({ encoding: "unavailable" });
          }
        })();
        void Promise.all([requestSnapshot, responseSnapshot]).then(([requestBody, responseBody]) => {
          reportExchange({
            traceId,
            exchangeId: eventId(),
            route: exchangeUrl.pathname,
            method: request.method,
            userAgent: navigator.userAgent,
            requestId: response.headers.get("x-request-id") || request.headers.get("x-request-id") || undefined,
            httpStatus: response.status,
            durationMs: Date.now() - startedAt,
            outcome: response.ok ? "succeeded" : "failed",
            request: {
              method: request.method,
              url: exchangeUrl.href,
              headers: headerSnapshot(request.headers),
              ...requestBody,
            },
            response: {
              status: response.status,
              statusText: response.statusText,
              headers: headerSnapshot(response.headers),
              ...responseBody,
            },
          });
        }).catch(() => undefined);
        if (!response.ok && (response.status >= 500 || response.status === 429)) {
          report({ name: "ApiResponseError", message: `API 请求失败（HTTP ${response.status}）`, apiPath: exchangeUrl.pathname, method, httpStatus: response.status, traceId, requestId: response.headers.get("x-request-id") || undefined, impact: response.status >= 500 ? "blocked" : "degraded" });
        }
        return response;
      } catch (error) {
        const details = errorDetails(error);
        void requestSnapshot.then((requestBody) => {
          reportExchange({
            traceId,
            exchangeId: eventId(),
            route: exchangeUrl.pathname,
            method: request.method,
            userAgent: navigator.userAgent,
            durationMs: Date.now() - startedAt,
            outcome: "failed",
            request: {
              method: request.method,
              url: exchangeUrl.href,
              headers: headerSnapshot(request.headers),
              ...requestBody,
            },
            response: null,
            error: { name: details.name, message: details.message, stack: details.stack },
          });
        }).catch(() => undefined);
        report({ name: text(details.name, 160) || "NetworkError", message: text(details.message, 1_000), stack: text(details.stack, 2_000), apiPath: exchangeUrl.pathname, method, traceId, impact: "degraded" });
        throw error;
      }
    };
    window.fetch = wrappedFetch;

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      // Restore only our own wrapper so another runtime instrument installed later is preserved.
      // 仅在当前仍是本组件包装器时恢复，避免覆盖后续安装的其他运行时监控。
      if (window.fetch === wrappedFetch) window.fetch = originalFetch;
    };
  }, [deploymentVersion, systemVersion]);

  return null;
}
