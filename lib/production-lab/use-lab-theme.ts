// Adapted from ddcat-ai/open-ai-canvas web/src/stores/use-theme-store.ts.
// MIT; full notices: ./vendor/open-ai-canvas-LICENSE. Independent persistence key.
import { create } from "zustand";
import { persist } from "zustand/middleware";
type ThemeName = "light" | "dark";
type ThemeStore = { theme: ThemeName; setTheme: (value: ThemeName) => void };
const VALID_THEMES: ThemeName[] = ["light", "dark"];
export const LAB_THEME_STORAGE_KEY = "fg-production-lab-appearance-v1";
export const useLabTheme = create<ThemeStore>()(persist(
  set => ({ theme: "light", setTheme: value => set(state => VALID_THEMES.includes(value) ? { theme: value } : state) }),
  { name: LAB_THEME_STORAGE_KEY, skipHydration: true,
    merge: (persisted, current) => ({ ...current, theme: (persisted as Partial<ThemeStore> | null)?.theme === "dark" ? "dark" : "light" }) }
));
