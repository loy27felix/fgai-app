import { createBrowserRouter, Outlet } from "react-router-dom";

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

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/config", element: <ConfigPage /> },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
