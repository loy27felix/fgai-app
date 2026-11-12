import { create } from "zustand";

export type PersonalAppearance = {
    userId: string;
    skinId: "site" | "classic" | "longying-ink" | "yunhe-xianguan";
    font: "theme" | "system" | "sans" | "serif";
    mode: "system" | "light" | "dark";
    revision: number;
};

// Only the active account is held in memory; the server is the cross-device source.
export const usePersonalAppearanceStore = create<{
    value: PersonalAppearance | null;
    setValue: (value: PersonalAppearance | null) => void;
}>((set) => ({ value: null, setValue: (value) => set({ value }) }));
