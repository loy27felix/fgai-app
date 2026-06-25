"use client";
import { useState } from "react";
import { useEffect } from "react";

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

/* 带 hover / active 内联样式切换的元素 */
type HovProps = { as?: any; base?: React.CSSProperties; hover?: React.CSSProperties; active?: React.CSSProperties; children?: React.ReactNode; [k: string]: any; };
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

/* 就地编辑：单行。失焦且有改动才保存（非受控 defaultValue） */
export function EditInput({ value, onSave, placeholder, mono, disabled, style }: {
  value: string; onSave: (v: string) => void; placeholder?: string; mono?: boolean; disabled?: boolean; style?: React.CSSProperties;
}) {
  const [f, setF] = useState(false);
  return (
    <input defaultValue={value} placeholder={placeholder} disabled={disabled} className={mono ? "fg-mono" : undefined}
      onFocus={() => setF(true)} onBlur={(e) => { setF(false); if (!disabled && e.target.value !== value) onSave(e.target.value); }}
      style={{ background: f ? "var(--bg-2)" : "transparent", border: `1px solid ${f ? "var(--stroke-2)" : "transparent"}`, borderRadius: 8, padding: "4px 8px", color: "var(--text)", outline: "none", font: "inherit", width: "100%", ...style }} />
  );
}

/* 就地编辑：多行。失焦且有改动才保存 */
export function EditArea({ value, onSave, placeholder, minH = 90, disabled, style }: {
  value: string; onSave: (v: string) => void; placeholder?: string; minH?: number; disabled?: boolean; style?: React.CSSProperties;
}) {
  const [f, setF] = useState(false);
  return (
    <textarea defaultValue={value} placeholder={placeholder} disabled={disabled}
      onFocus={() => setF(true)} onBlur={(e) => { setF(false); if (!disabled && e.target.value !== value) onSave(e.target.value); }}
      style={{ width: "100%", minHeight: minH, resize: "vertical", background: f ? "var(--bg-2)" : "transparent", border: `1px solid ${f ? "var(--stroke-2)" : "var(--stroke)"}`, borderRadius: 10, padding: "10px 12px", color: "var(--text)", outline: "none", font: "inherit", lineHeight: 1.8, ...style }} />
  );
}
