import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#212121",
        primary: "#17171c",
        green: { DEFAULT: "#003c33", soft: "#0c5a4e", pale: "#edfce9" },
        stone: "#eeece7",
        hairline: "#e6e4dd",
        coral: "#ff7759",
        violet: "#9b60aa",
        cyan: "#3ce0d0",
        muted: "#93939f",
      },
      fontFamily: {
        disp: ['"Space Grotesk"', "Inter", "system-ui", "sans-serif"],
        mono: ['"Space Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: { pill: "32px" },
    },
  },
  plugins: [],
};
export default config;
