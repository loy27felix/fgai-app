"use client";

import { MemoryRouter, Route, Routes } from "react-router-dom";
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

export default function InfiniteCanvasReferenceHost() {
  return (
    <AppProviders>
      <MemoryRouter initialEntries={["/"]}>
        <ReferenceRoutes />
        <CreatorUsageLedger />
      </MemoryRouter>
    </AppProviders>
  );
}
