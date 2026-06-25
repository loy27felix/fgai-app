"use client";
import { useEffect, useState } from "react";

/* 线性 SVG 图标：传入 path d 数组 */
export function Icon({ d, size = 18, sw = 1.6 }: { d: readonly string[]; size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      {d.map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

/* 日/夜模式：写 .dark 到 <html>，并持久化；新页用 data-theme 取 CSS 变量 */
export function useFgTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    let init: "dark" | "light" = "dark";
    try {
      const s = localStorage.getItem("fg-theme");
      if (s === "light" || s === "dark") init = s;
      else if (!document.documentElement.classList.contains("dark")) init = "light";
    } catch {}
    setTheme(init);
  }, []);
  useEffect(() => {
    try { localStorage.setItem("fg-theme", theme); } catch {}
    const html = document.documentElement;
    if (theme === "dark") html.classList.add("dark"); else html.classList.remove("dark");
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")), setTheme };
}

/* 带 hover / active 内联样式切换的元素（替代 .dc 的 style-hover/style-active） */
type HovProps = {
  as?: any;
  base?: React.CSSProperties;
  hover?: React.CSSProperties;
  active?: React.CSSProperties;
  children?: React.ReactNode;
  [k: string]: any;
};
export function Hov({ as, base, hover, active, children, ...rest }: HovProps) {
  const [h, setH] = useState(false);
  const [a, setA] = useState(false);
  const El: any = as || "div";
  return (
    <El
      {...rest}
      style={{ ...(base || {}), ...(h && hover ? hover : {}), ...(a && active ? active : {}) }}
      onMouseEnter={(e: any) => { setH(true); rest.onMouseEnter?.(e); }}
      onMouseLeave={(e: any) => { setH(false); setA(false); rest.onMouseLeave?.(e); }}
      onMouseDown={(e: any) => { setA(true); rest.onMouseDown?.(e); }}
      onMouseUp={(e: any) => { setA(false); rest.onMouseUp?.(e); }}
    >
      {children}
    </El>
  );
}
