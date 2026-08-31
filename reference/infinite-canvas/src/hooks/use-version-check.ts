import { useCallback, useState } from "react";
import { APP_VERSION } from "@/reference/infinite-canvas/src/constant/env";
import { FG_RELEASE_NOTES } from "@/reference/infinite-canvas/src/lib/fg-release-notes";

export function useVersionCheck() {
    const currentVersion = APP_VERSION;
    const [open, setOpen] = useState(false);
    const openReleaseModal = useCallback(() => setOpen(true), []);

    return {
        open,
        setOpen,
        openReleaseModal,
        latestVersion: currentVersion,
        releases: FG_RELEASE_NOTES,
        checking: false,
        hasNewVersion: false,
        checkLatestRelease: async () => true,
    };
}
