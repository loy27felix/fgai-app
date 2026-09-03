"use client";
import { useEffect, useState } from "react";

export function Icon({ d, size = 18, sw = 1.6 }: { d: readonly string[]; size?: number; sw?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      {d.map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

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

type HovProps = { as?: any; base?: React.CSSProperties; hover?: React.CSSProperties; active?: React.CSSProperties; children?: React.ReactNode; [k: string]: any; };
export function Hov({ as, base, hover, active, children, ...rest }: HovProps) {
  const [h, setH] = useState(false);
  const [a, setA] = useState(false);
  const El: any = as || "div";
  return (
    <El {...rest}
      style={{ ...(base || {}), ...(h && hover ? hover : {}), ...(a && active ? active : {}) }}
      onMouseEnter={(e: any) => { setH(true); rest.onMouseEnter?.(e); }}
      onMouseLeave={(e: any) => { setH(false); setA(false); rest.onMouseLeave?.(e); }}
      onMouseDown={(e: any) => { setA(true); rest.onMouseDown?.(e); }}
      onMouseUp={(e: any) => { setA(false); rest.onMouseUp?.(e); }}>
      {children}
    </El>
  );
}

type SaveState = "idle" | "saving" | "saved";
function StatusBadge({ st }: { st: SaveState }) {
  if (st === "idle") return null;
  return <span className="fg-mono" style={{ position: "absolute", right: 9, bottom: 7, fontSize: 10, padding: "2px 7px", borderRadius: 6, pointerEvents: "none", color: st === "saving" ? "var(--text-3)" : "var(--accent)", background: "var(--panel-solid)", border: "1px solid var(--stroke)" }}>{st === "saving" ? "保存中…" : "已保存 ✓"}</span>;
}

export function EditInput({ value, onSave, placeholder, mono, disabled, style }: {
  value: string; onSave: (v: string) => void | Promise<any>; placeholder?: string; mono?: boolean; disabled?: boolean; style?: React.CSSProperties;
}) {
  const [f, setF] = useState(false);
  const [st, setSt] = useState<SaveState>("idle");
  async function blur(e: React.FocusEvent<HTMLInputElement>) {
    setF(false);
    if (!disabled && e.target.value !== value) { setSt("saving"); try { await onSave(e.target.value); } finally { setSt("saved"); setTimeout(() => setSt("idle"), 1500); } }
  }
  return (
    <span style={{ position: "relative", display: "block" }}>
      <input defaultValue={value} placeholder={placeholder} disabled={disabled} className={mono ? "fg-mono" : undefined}
        onFocus={() => setF(true)} onBlur={blur}
        style={{ background: f ? "var(--bg-2)" : "transparent", border: `1px solid ${f ? "var(--stroke-2)" : "transparent"}`, borderRadius: 8, padding: "4px 8px", color: "var(--text)", outline: "none", font: "inherit", width: "100%", ...style }} />
      {st === "saved" && <span style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", color: "var(--accent)", pointerEvents: "none" }}><Icon d={["M5 13l4 4L19 7"]} size={13} sw={2.4} /></span>}
    </span>
  );
}

export function EditArea({ value, onSave, placeholder, minH = 90, disabled, style }: {
  value: string; onSave: (v: string) => void | Promise<any>; placeholder?: string; minH?: number; disabled?: boolean; style?: React.CSSProperties;
}) {
  const [f, setF] = useState(false);
  const [st, setSt] = useState<SaveState>("idle");
  async function blur(e: React.FocusEvent<HTMLTextAreaElement>) {
    setF(false);
    if (!disabled && e.target.value !== value) { setSt("saving"); try { await onSave(e.target.value); } finally { setSt("saved"); setTimeout(() => setSt("idle"), 1600); } }
  }
  return (
    <div style={{ position: "relative" }}>
      <textarea defaultValue={value} placeholder={placeholder} disabled={disabled}
        onFocus={() => setF(true)} onBlur={blur}
        style={{ width: "100%", minHeight: minH, resize: "vertical", background: f ? "var(--bg-2)" : "transparent", border: `1px solid ${f ? "var(--stroke-2)" : "var(--stroke)"}`, borderRadius: 10, padding: "10px 12px", color: "var(--text)", outline: "none", font: "inherit", lineHeight: 1.8, ...style }} />
      <StatusBadge st={st} />
    </div>
  );
}
