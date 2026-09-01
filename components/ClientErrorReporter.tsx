"use client";

import { useEffect } from "react";

type ClientErrorReporterProps = {
  deploymentVersion: string;
  systemVersion: string;
};

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

export default function ClientErrorReporter({ deploymentVersion, systemVersion }: ClientErrorReporterProps) {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    let reporting = false;

    const report = (input: Record<string, unknown>) => {
      if (reporting) return;
      reporting = true;
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
        }).catch(() => undefined).finally(() => { reporting = false; });
      } catch {
        reporting = false;
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
      try {
        const response = await originalFetch(input, init);
        const shouldReportResponse = requestUrl
          && requestUrl.pathname.startsWith("/api/")
          && requestUrl.pathname !== "/api/observability/client-errors"
          && (response.status >= 500 || response.status === 429);
        if (!response.ok && shouldReportResponse && requestUrl) {
          report({ name: "ApiResponseError", message: `API 请求失败（HTTP ${response.status}）`, apiPath: requestUrl.pathname, method, httpStatus: response.status, impact: response.status >= 500 ? "blocked" : "degraded" });
        }
        return response;
      } catch (error) {
        if (requestUrl && requestUrl.pathname.startsWith("/api/") && requestUrl.pathname !== "/api/observability/client-errors") {
          const details = errorDetails(error);
          report({ name: text(details.name, 160) || "NetworkError", message: text(details.message, 1_000), stack: text(details.stack, 2_000), apiPath: requestUrl.pathname, method, impact: "degraded" });
        }
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
