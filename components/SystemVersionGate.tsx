"use client";

import { useEffect, useState } from "react";
import { compareSystemVersions, SYSTEM_VERSION } from "@/lib/version";

type VersionResponse = {
  requiredSystemVersion?: unknown;
};

export default function SystemVersionGate() {
  const [requiredVersion, setRequiredVersion] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const checkVersion = async () => {
      try {
        const response = await fetch("/api/version", {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        if (!response.ok) return;

        const data = (await response.json()) as VersionResponse;
        const required = typeof data.requiredSystemVersion === "string" ? data.requiredSystemVersion : "";
        if (active && required && compareSystemVersions(SYSTEM_VERSION, required) < 0) {
          setRequiredVersion(required);
        }
      } catch {
        // Fail open when the diagnostic endpoint is unavailable.
        // 版本接口暂时不可用时放行，避免诊断链路故障阻断正常使用。
      }
    };

    void checkVersion();
    const interval = window.setInterval(checkVersion, 60_000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  if (!requiredVersion) return null;

  return (
    <div className="app-version-gate" role="dialog" aria-modal="true" aria-labelledby="app-version-gate-title">
      <div className="app-version-gate-card">
        <div className="app-version-gate-kicker">FG STUDIO / SYSTEM UPDATE</div>
        <h1 id="app-version-gate-title">需要升级系统</h1>
        <p>
          当前页面版本 v{SYSTEM_VERSION} 已过期，请升级到 v{requiredVersion} 后继续使用。
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          立即升级
        </button>
      </div>
    </div>
  );
}
