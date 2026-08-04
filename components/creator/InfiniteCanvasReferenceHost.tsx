"use client";

import { useEffect } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppProviders } from "@/reference/infinite-canvas/src/components/layout/app-providers";
import { AnalyticsTracker } from "@/reference/infinite-canvas/src/components/layout/analytics-tracker";
import UserLayout from "@/reference/infinite-canvas/src/layouts/user-layout";
import AssetsPage from "@/reference/infinite-canvas/src/pages/assets";
import CanvasPage from "@/reference/infinite-canvas/src/pages/canvas";
import CanvasProjectPage from "@/reference/infinite-canvas/src/pages/canvas/project";
import ConfigPage from "@/reference/infinite-canvas/src/pages/config";
import HomePage from "@/reference/infinite-canvas/src/pages/home";
import ImagePage from "@/reference/infinite-canvas/src/pages/image";
import NotFound from "@/reference/infinite-canvas/src/pages/not-found";
import PromptsPage from "@/reference/infinite-canvas/src/pages/prompts";
import VideoPage from "@/reference/infinite-canvas/src/pages/video";
import CreatorUsageLedger from "@/components/creator/CreatorUsageLedger";

function ReferenceRoutes() {
  return (
    <div className="fg-reference-root h-full min-h-0">
      <UserLayout>
        <AnalyticsTracker />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/canvas" element={<CanvasPage />} />
          <Route path="/canvas/:id" element={<CanvasProjectPage />} />
          <Route path="/image" element={<ImagePage />} />
          <Route path="/video" element={<VideoPage />} />
          <Route path="/prompts" element={<PromptsPage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/config" element={<ConfigPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </UserLayout>
    </div>
  );
}

function initialCreatorRoute() {
  if (typeof window === "undefined") return "/";
  const route = window.location.hash.slice(1);
  return route.startsWith("/") ? route : "/";
}

/**
 * The reference canvas intentionally uses a MemoryRouter, but the outer Next
 * page still needs normal browser Back/Forward behavior. Mirror route changes
 * into a hash entry so leaving the canvas only happens after its inner routes
 * have been traversed.
 */
function BrowserHistoryBridge() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const route = location.pathname + location.search + location.hash;
    const hash = route === "/" ? "" : route;
    if (window.location.hash.slice(1) === hash) return;
    const base = window.location.pathname + window.location.search;
    const target = base + (hash ? "#" + hash : "");
    window.history.pushState({ fgCreatorRoute: route }, "", target);
  }, [location.hash, location.pathname, location.search]);

  useEffect(() => {
    const onPopState = () => {
      const route = window.location.hash.slice(1);
      navigate(route.startsWith("/") ? route : "/", { replace: true });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [navigate]);

  return null;
}

export default function InfiniteCanvasReferenceHost() {
  return (
    <AppProviders>
      <MemoryRouter initialEntries={[initialCreatorRoute()]}>
        <BrowserHistoryBridge />
        <ReferenceRoutes />
        <CreatorUsageLedger />
      </MemoryRouter>
    </AppProviders>
  );
}
