import { App } from "antd";
import { useCallback } from "react";
import { getPersonalAppearance, savePersonalAppearance } from "@/services/api/personal-appearance";
import { usePersonalAppearanceStore } from "@/stores/use-personal-appearance-store";
import { useThemeStore, type ThemeName } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

let pendingSave = Promise.resolve();
let latestToggle = 0;

export function usePersonalThemeToggle() {
    const { message } = App.useApp();
    return useCallback((mode: ThemeName) => {
        const userId = useUserStore.getState().user?.id;
        const previous = useThemeStore.getState().theme;
        useThemeStore.getState().setTheme(mode);
        const toggle = ++latestToggle;
        if (!userId) return;

        const isCurrentAccount = () => useUserStore.getState().user?.id === userId;
        pendingSave = pendingSave.then(async () => {
            if (!isCurrentAccount() || toggle !== latestToggle) return;
            const profile = await getPersonalAppearance();
            if (!isCurrentAccount() || profile.userId !== userId || toggle !== latestToggle) return;
            const saved = await savePersonalAppearance({ ...profile, mode });
            if (isCurrentAccount() && saved.userId === userId && toggle === latestToggle) {
                usePersonalAppearanceStore.getState().setValue(saved);
            }
        }).catch((error: unknown) => {
            if (!isCurrentAccount() || toggle !== latestToggle) return;
            const current = usePersonalAppearanceStore.getState().value;
            const fallback = current?.mode === "system"
                ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
                : current?.mode || previous;
            useThemeStore.getState().setTheme(fallback);
            message.error(error instanceof Error ? error.message : "个人明暗模式保存失败");
        });
    }, [message]);
}
