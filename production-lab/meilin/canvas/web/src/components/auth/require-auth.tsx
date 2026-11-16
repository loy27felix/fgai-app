import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { useUserStore } from "@/stores/use-user-store";
import { fgLoginPath, isNativeAuth } from "@/lib/fg-entry-url";
import { FGSessionRecovery } from "./fg-session-recovery";

export function RequireAuth({ children }: { children: ReactNode }) {
    const location = useLocation();
    const hydrated = useUserStore((state) => state.hydrated);
    const user = useUserStore((state) => state.user);

    if (!hydrated) return <FullScreenLoader />;
    if (!user && isNativeAuth) return <Navigate to={fgLoginPath(`${location.pathname}${location.search}${location.hash}`)} replace />;
    if (!user) return <FGSessionRecovery />;
    return children;
}
