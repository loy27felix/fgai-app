import type { ReactNode } from "react";

import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { useUserStore } from "@/stores/use-user-store";
import { FGSessionRecovery } from "./fg-session-recovery";

export function RequireAuth({ children }: { children: ReactNode }) {
    const hydrated = useUserStore((state) => state.hydrated);
    const user = useUserStore((state) => state.user);

    if (!hydrated) return <FullScreenLoader />;
    if (!user) return <FGSessionRecovery />;
    return children;
}
