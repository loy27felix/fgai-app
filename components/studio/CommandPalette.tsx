"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./ui";

export type PaletteItem = { title: string; sub?: string; body: string; group: string };

export default function CommandPalette({ open, onClose, title, hint, items, onPick, accentGroup, extraTop, searchPlaceholder, multi, isSelected }: {
  open: boolean; onClose: () => void; title: string; hint?: string;
  items: PaletteItem[]; onPick: (it: PaletteItem) => void; accentGroup?: string;
  extraTop?: React.ReactNode; searchPlaceholder?: string; multi?: boolean; isSelected?: (it: PaletteItem) => boolean;
}) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("全部");
  const inputRef = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => ["全部", ...Array.from(new Set(items.map((i) => i.group)))], [items]);
  const filtered = useMemo(() => items.filter((i) => (group === "全部" || i.group === group) && (!q || (i.title + i.body + (i.sub || "")).toLowerCase().includes(q.toLowerCase()))), [items, group, q]);

  useEffect(() => { if (open) { setQ(""); setGroup("全部"); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);
  if (!open || typeof document === "undefined") return null;
  const theme = document.documentElement.classList.contains("dark") ? "dark" : "light";

  const overlay = (
    <div data-theme={theme} className="fg2" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(2,6,16,.6)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", display: "grid", placeItems: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 680, maxWidth: "100%", maxHeight: "82vh", display: "flex", flexDirection: "column", background: "var(--panel-solid)", color: "var(--text)", border: "1px solid var(--stroke-2)", borderRadius: 22, boxShadow: "var(--shadow)", overflow: "hidden", animation: "blurUp .28s var(--ease) both" }}>
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "16px 18px", borderBottom: "1px solid var(--stroke)" }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{title}</span>
          {hint && <span style={{ fontSize: 12, color: "var(--text-3)" }}>{hint}</span>}
          {multi && <span className="fg-mono" style={{ fontSize: 10, color: "var(--accent)", padding: "2px 8px", borderRadius: 6, background: "var(--user-bubble)", border: "1px solid var(--user-stroke)" }}>可多选</span>}
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, width: 240, height: 36, padding: "0 12px", borderRadius: 11, background: "var(--bg-2)", border: "1px solid var(--stroke)" }}>
            <Icon d={["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z", "m20 20-3.5-3.5"]} size={16} sw={1.7} />
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && filtered[0]) { onPick(filtered[0]); if (!multi) onClose(); } if (e.key === "Escape") onClose(); }}
              placeholder={searchPlaceholder || "搜索…"} style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: 13.5, fontFamily: "inherit" }} />
          </div>
          <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: 11, display: "grid", placeItems: "center", cursor: "pointer", color: "var(--text-3)", background: "transparent", border: "1px solid var(--stroke)" }}><Icon d={["M6 6l12 12M18 6 6 18"]} size={16} sw={1.8} /></button>
        </div>

        <div style={{ flex: "none", display: "flex", flexWrap: "wrap", gap: 6, padding: "12px 18px", borderBottom: "1px solid var(--stroke)" }}>
          {groups.map((g) => { const on = g === group; return (
            <button key={g} onClick={() => setGroup(g)} className="fg-mono" style={{ padding: "5px 11px", borderRadius: 999, cursor: "pointer", fontSize: 11.5, color: on ? "var(--accent-ink)" : "var(--text-2)", background: on ? "var(--accent)" : "var(--panel)", border: `1px solid ${on ? "transparent" : "var(--stroke)"}` }}>{g}</button>
          ); })}
        </div>

        {extraTop && <div style={{ flex: "none", padding: "12px 18px 0" }}>{extraTop}</div>}

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {filtered.length === 0 ? <div style={{ gridColumn: "1 / -1", textAlign: "center", color: "var(--text-3)", padding: "40px 0", fontSize: 13 }}>没有匹配项</div> :
            filtered.map((it, i) => { const sel = isSelected ? isSelected(it) : false; return (
              <button key={i} onClick={() => { onPick(it); if (!multi) onClose(); }} style={{ position: "relative", textAlign: "left", display: "flex", flexDirection: "column", gap: 6, padding: "12px 13px", borderRadius: 14, cursor: "pointer", background: sel ? "var(--user-bubble)" : "var(--panel)", border: `1px solid ${sel ? "var(--accent)" : "var(--stroke)"}`, transition: "all .2s var(--ease)" }}
                onMouseEnter={(e) => { if (!sel) e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                onMouseLeave={(e) => { if (!sel) e.currentTarget.style.borderColor = "var(--stroke)"; e.currentTarget.style.transform = "none"; }}>
                {sel && <span style={{ position: "absolute", right: 9, top: 9, width: 18, height: 18, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--accent)", color: "var(--accent-ink)" }}><Icon d={["M5 13l4 4L19 7"]} size={11} sw={2.6} /></span>}
                <div style={{ display: "flex", alignItems: "center", gap: 8, paddingRight: sel ? 22 : 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{it.title}</span>
                  <span className="fg-mono" style={{ fontSize: 9.5, color: it.group === accentGroup ? "var(--accent)" : "var(--text-3)", padding: "1px 6px", borderRadius: 6, background: "var(--bg-2)" }}>{it.group}</span>
                </div>
                {it.sub && <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>{it.sub}</div>}
                <div style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" } as any}>{it.body.replace(/^@file:.*/, "点选启用此工作流技能")}</div>
              </button>
            ); })}
        </div>
      </div>
    </div>
  );
  return createPortal(overlay, document.body);
}
