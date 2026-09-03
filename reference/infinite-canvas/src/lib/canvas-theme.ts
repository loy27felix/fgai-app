export type CanvasColorTheme = "light" | "dark" | "custom";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#f4f2ed",
            dot: "rgba(68,64,60,.28)",
            line: "rgba(68,64,60,.12)",
            selectionStroke: "#1c1917",
            selectionFill: "rgba(28,25,23,.06)",
        },
        node: {
            label: "#57534e",
            fill: "#e7e5df",
            panel: "#fbfaf7",
            stroke: "#d6d3ca",
            activeStroke: "#1c1917",
            placeholder: "#8a8479",
            text: "#292524",
            muted: "#78716c",
            faint: "#a8a29e",
        },
        toolbar: {
            panel: "rgba(251,250,247,.96)",
            border: "#d6d3ca",
            item: "#57534e",
            itemHover: "#e7e5df",
            activeBg: "#e7e5df",
            activeText: "#292524",
        },
    },
    dark: {
        canvas: {
            background: "#181715",
            dot: "rgba(245,245,244,.24)",
            line: "rgba(245,245,244,.10)",
            selectionStroke: "#fafaf9",
            selectionFill: "rgba(250,250,249,.10)",
        },
        node: {
            label: "#d6d3d1",
            fill: "#292524",
            panel: "#1f1d1a",
            stroke: "#44403c",
            activeStroke: "#fafaf9",
            placeholder: "#a8a29e",
            text: "#f5f5f4",
            muted: "#d6d3d1",
            faint: "#78716c",
        },
        toolbar: {
            panel: "rgba(31,29,26,.96)",
            border: "#44403c",
            item: "#d6d3d1",
            itemHover: "#292524",
            activeBg: "#3a3631",
            activeText: "#f5f5f4",
        },
    },
    custom: {
        canvas: {
            background: "#121417",
            dot: "rgba(246,247,251,.30)",
            line: "rgba(246,247,251,.14)",
            selectionStroke: "#f8fafc",
            selectionFill: "rgba(248,250,252,.12)",
        },
        node: {
            label: "#d9e0e8",
            fill: "#20252b",
            panel: "#181c21",
            stroke: "#454d57",
            activeStroke: "#f8fafc",
            placeholder: "#9da8b6",
            text: "#f1f5f9",
            muted: "#c8d1dc",
            faint: "#788493",
        },
        toolbar: {
            panel: "rgba(18,22,27,.92)",
            border: "#46505d",
            item: "#d5dde8",
            itemHover: "rgba(91,105,122,.30)",
            activeBg: "rgba(111,126,145,.42)",
            activeText: "#ffffff",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
