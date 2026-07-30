"use client";

import { useEffect } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppProviders } from "@/reference/infinite-canvas/src/components/layout/app-providers";
import { AgentPanel } from "@/reference/infinite-canvas/src/components/agent/agent-panel";
import CanvasProjectPage from "@/reference/infinite-canvas/src/pages/canvas/project";
import { useCanvasStore } from "@/reference/infinite-canvas/src/stores/canvas/use-canvas-store";
import CreatorUsageLedger from "@/components/creator/CreatorUsageLedger";

function CanvasRedirect() {
  const navigate = useNavigate();
  const projects = useCanvasStore((state) => state.projects);
  useEffect(() => {
    const id = projects[0]?.id;
    if (id) navigate(`/canvas/${id}`, { replace: true });
  }, [navigate, projects]);
  return <div className="flex h-full items-center justify-center text-sm opacity-60">正在打开无限画布…</div>;
}

function CanvasBootstrap() {
  const hydrated = useCanvasStore((state) => state.hydrated);
  const projects = useCanvasStore((state) => state.projects);
  const createProject = useCanvasStore((state) => state.createProject);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!hydrated) return;
    if (!projects.length) {
      const id = createProject("FG 无限画布");
      navigate(`/canvas/${id}`, { replace: true });
      return;
    }
    if (location.pathname === "/canvas" || location.pathname === "/") {
      navigate(`/canvas/${projects[0].id}`, { replace: true });
    }
  }, [createProject, hydrated, location.pathname, navigate, projects]);

  if (!hydrated) return <div className="flex h-full items-center justify-center text-sm opacity-60">正在加载画布…</div>;
  return (
    <Routes>
      <Route path="/canvas/:id" element={<CanvasProjectPage />} />
      <Route path="*" element={<CanvasRedirect />} />
    </Routes>
  );
}

export default function InfiniteCanvasReferenceHost() {
  return (
    <AppProviders>
      <MemoryRouter initialEntries={["/canvas"]}>
        <div className="fg-reference-root relative flex h-dvh min-h-0 overflow-hidden bg-background text-foreground">
          <div className="min-w-0 flex-1 overflow-hidden"><CanvasBootstrap /></div>
          <AgentPanel />
          <CreatorUsageLedger />
        </div>
      </MemoryRouter>
    </AppProviders>
  );
}