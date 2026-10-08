import { lazy, Suspense } from "react";
import { ReactFlowProvider } from "@xyflow/react";

import "@xyflow/react/dist/style.css";
import "./agent-canvas-page.css";

const AgentCanvasPageSurface = lazy(() => import("./AgentCanvasPageSurface.tsx").then((module) => ({
  default: module.AgentCanvasPage,
})));

export function AgentCanvasPage() {
  return (
    <ReactFlowProvider>
      <Suspense fallback={<div className="agent-canvas-state" role="status">正在打开广告工程…</div>}>
        <AgentCanvasPageSurface />
      </Suspense>
    </ReactFlowProvider>
  );
}
