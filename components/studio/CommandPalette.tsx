"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./ui";

export type PaletteItem = { title: string; sub?: string; body: string; group: string; img?: string };

export default function CommandPalette({ open, onClose, title, hint, items, onPick, accentGroup, extraTop, searchPlaceholder, multi, isSelected }: {
  open: boolean; onClose: () => void; title: string; hint?: string;
  items: PaletteItem[]; onPick: (it: PaletteItem) => void; accentGroup?: string;
  extraTop?: React.ReactNode; searchPlaceholder?: string; multi?: boolean; isSelected?: (it: PaletteItem) => boolean;
}) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("全部");
  const [preview, setPreview] = useState<PaletteItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => ["全部", ...Array.from(new Set(items.map((i) => i.group)))], [items]);
  const filtered = useMemo(() => items.filter((i) => (group === "全部" || i.group === group) && (!q || (i.title + i.body + (i.sub || "")).toLowerCase().includes(q.toLowerCase()))), [items, group, q]);

  useEffect(() => { if (open) { setQ(""); setGroup("全部"); setPreview(null); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);
  if (!open || typeof document === "undefined") return null;
  const theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
  const isFile = (b: string) => b.startsWith("@file:");

  const overlay = (
    <div data-theme={theme} className="fg2" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(2,6,16,.6)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", display: "grid", placeItems: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", width: 720, maxWidth: "100%", maxHeight: "84vh", display: "flex", flexDirection: "column", background: "var(--panel-solid)", color: "var(--text)", border: "1px solid var(--stroke-2)", borderRadius: 22, boxShadow: "var(--shadow)", overflow: "hidden", animation: "blurUp .28s var(--ease) both" }}>
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
              <div key={i} style={{ position: "relative", display: "flex", gap: 10, padding: "11px 12px", borderRadius: 14, background: sel ? "var(--user-bubble)" : "var(--panel)", border: `1px solid ${sel ? "var(--accent)" : "var(--stroke)"}`, transition: "all .2s var(--ease)" }}>
                {it.img && <img src={it.img} alt="" style={{ flex: "none", width: 52, height: 52, borderRadius: 9, objectFit: "cover", border: "1px solid var(--stroke-2)" }} />}
                <button onClick={() => { onPick(it); if (!multi) onClose(); }} style={{ flex: 1, minWidth: 0, textAlign: "left", display: "flex", flexDirection: "column", gap: 5, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, paddingRight: 36 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</span>
                    <span className="fg-mono" style={{ flex: "none", fontSize: 9.5, color: it.group === accentGroup ? "var(--accent)" : "var(--text-3)", padding: "1px 6px", borderRadius: 6, background: "var(--bg-2)" }}>{it.group}</span>
                  </div>
                  {it.sub && <div style={{ fontSize: 11.5, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.sub}</div>}
                  <div style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" } as any}>{isFile(it.body) ? "点选启用此工作流技能" : it.body}</div>
                </button>
                <button onClick={() => setPreview(it)} title="查看完整内容" style={{ position: "absolute", right: 8, top: 8, width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", cursor: "pointer", color: "var(--text-3)", background: "var(--bg-2)", border: "1px solid var(--stroke)" }}><Icon d={["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"]} size={14} sw={1.6} /></button>
                {sel && <span style={{ position: "absolute", right: 8, bottom: 8, width: 18, height: 18, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--accent)", color: "var(--accent-ink)" }}><Icon d={["M5 13l4 4L19 7"]} size={11} sw={2.6} /></span>}
              </div>
            ); })}
        </div>

        {/* 完整内容预览 */}
        {preview && (
          <div onClick={() => setPreview(null)} style={{ position: "absolute", inset: 0, zIndex: 5, background: "rgba(2,6,16,.55)", backdropFilter: "blur(4px)", display: "grid", placeItems: "center", padding: 22 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 560, maxHeight: "100%", display: "flex", flexDirection: "column", background: "var(--panel-solid)", border: "1px solid var(--stroke-2)", borderRadius: 18, boxShadow: "var(--shadow)", overflow: "hidden" }}>
              <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--stroke)" }}>
                <span style={{ fontSize: 14.5, fontWeight: 600 }}>{preview.title}</span>
                <span className="fg-mono" style={{ fontSize: 10, color: "var(--text-3)", padding: "1px 6px", borderRadius: 6, background: "var(--bg-2)" }}>{preview.group}</span>
                <div style={{ flex: 1 }} />
                <button onClick={() => setPreview(null)} style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", cursor: "pointer", color: "var(--text-3)", background: "transparent", border: "1px solid var(--stroke)" }}><Icon d={["M6 6l12 12M18 6 6 18"]} size={15} sw={1.8} /></button>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16 }}>
                {preview.img && <img src={preview.img} alt="" style={{ width: "100%", maxHeight: 280, objectFit: "contain", borderRadius: 12, border: "1px solid var(--stroke-2)", marginBottom: 14, background: "var(--bg-2)" }} />}
                {preview.sub && <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 10 }}>{preview.sub}</div>}
                <div style={{ fontSize: 13, lineHeight: 1.75, color: "var(--text)", whiteSpace: "pre-wrap" }}>{isFile(preview.body) ? "工作流技能 · 启用后整段对话按该方法工作。" : preview.body}</div>
              </div>
              <div style={{ flex: "none", display: "flex", gap: 10, padding: "12px 16px", borderTop: "1px solid var(--stroke)" }}>
                <div style={{ flex: 1 }} />
                <button onClick={() => { onPick(preview); setPreview(null); if (!multi) onClose(); }} style={{ height: 40, padding: "0 18px", borderRadius: 12, cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none" }}>{multi ? "启用 / 取消" : "应用此项"}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
  return createPortal(overlay, document.body);
}
