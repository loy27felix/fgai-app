import { useEffect, useLayoutEffect } from "react";
import { getPersonalAppearance } from "@/services/api/personal-appearance";
import { usePersonalAppearanceStore } from "@/stores/use-personal-appearance-store";
import { useUserStore } from "@/stores/use-user-store";
import { useThemeStore } from "@/stores/use-theme-store";

export function PersonalAppearanceSync() {
    const userId = useUserStore((s) => s.user?.id);
    const value = usePersonalAppearanceStore((s) => s.value);
    useLayoutEffect(() => {
        if (usePersonalAppearanceStore.getState().value) {
            const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
            useThemeStore.getState().setTheme(systemDark ? "dark" : "light");
        }
        usePersonalAppearanceStore.getState().setValue(null);
        document.documentElement.removeAttribute("data-personal-font");
    }, [userId]);
    useEffect(() => {
        if (!userId) return;
        let controller: AbortController | undefined;
        const load = () => {
            controller?.abort();
            controller = new AbortController();
            const request = controller;
            void getPersonalAppearance(request.signal).then((next) => {
                const current = usePersonalAppearanceStore.getState().value;
                if (!request.signal.aborted && useUserStore.getState().user?.id === userId && next.userId === userId && (!current || next.revision >= current.revision)) usePersonalAppearanceStore.getState().setValue(next);
            }).catch((e) => { if (!request.signal.aborted) console.warn("个人外观暂未同步，保留当前显示", e); });
        };
        load();
        const focus = () => { if (document.visibilityState === "visible") load(); };
        window.addEventListener("focus", focus);
        return () => { controller?.abort(); window.removeEventListener("focus", focus); };
    }, [userId]);
    useLayoutEffect(() => {
        const root = document.documentElement;
        if (!value || value.userId !== userId) { root.removeAttribute("data-personal-font"); return; }
        root.dataset.personalFont = value.font;
        const system = window.matchMedia("(prefers-color-scheme: dark)");
        const apply = () => useThemeStore.getState().setTheme(value.mode === "system" ? (system.matches ? "dark" : "light") : value.mode);
        apply();
        if (value.mode === "system") system.addEventListener("change", apply);
        return () => system.removeEventListener("change", apply);
    }, [value, userId]);
    return null;
}
