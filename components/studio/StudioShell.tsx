"use client";
import { ReactNode } from "react";
import { Icon, Hov, useFgTheme } from "./ui";

export type StageKey = "bible" | "script" | "assets" | "board" | "shots" | "video" | "bgm";

const STAGES: { key: StageKey; no: string; label: string; d: string[] }[] = [
  { key: "bible",  no: "01", label: "立项 · 故事圣经", d: ["M12 6c-1.6-1-4.2-1.5-6.2-1.5S3 5 3 5v13s1.8-.5 3.8-.5S10.4 18 12 19m0-13c1.6-1 4.2-1.5 6.2-1.5S21 5 21 5v13s-1.8-.5-3.8-.5S13.6 18 12 19m0-13v13"] },
  { key: "script", no: "02", label: "剧本工作台", d: ["M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z", "M14 3v6h6M8 13h8M8 17h6"] },
  { key: "assets", no: "03", label: "资产库", d: ["M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5"] },
  { key: "board",  no: "04", label: "导演分镜表", d: ["M3 3h7v18H3z", "M14 3h7v11h-7z"] },
  { key: "shots",  no: "05", label: "逐镜头设计", d: ["M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z", "M12 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"] },
  { key: "video",  no: "06", label: "生视频", d: ["M4 5h16v14H4z", "M4 9h16M4 15h16M9 5v14M15 5v14"] },
  { key: "bgm",    no: "07", label: "BGM · 音频", d: ["M4 10v4M8 6v12M12 9v6M16 4v16M20 10v4"] },
];

export default function StudioShell({
  projectId, projectName, stageKey, saved, avatar = "ZH", right, children, dreamy = true,
}: {
  projectId: string; projectName: string; stageKey: StageKey;
  saved?: string; avatar?: string; right?: ReactNode; children: ReactNode; dreamy?: boolean;
}) {
  const { theme, toggle } = useFgTheme();
  const cur = STAGES.find((s) => s.key === stageKey) || STAGES[1];

  return (
    <div data-theme={theme} className="fg2" style={{ position: "relative", height: "100vh", overflow: "hidden", background: "var(--bg)", color: "var(--text)", fontSize: 15, lineHeight: 1.55, display: "flex", flexDirection: "column" }}>
      {dreamy && (
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(700px 540px at 100% 14%, var(--glow-coral), transparent 60%), radial-gradient(640px 520px at 90% 0%, var(--glow-rose), transparent 58%), radial-gradient(760px 600px at 2% -8%, var(--glow-b), transparent 58%)", animation: "glowpulse 16s var(--ease) infinite" }} />
          <div style={{ position: "absolute", top: -120, right: -70, width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle at 38% 34%, #ffc0a6, #ea8190 44%, #7c4d88 78%, transparent 84%)", opacity: 0.34, filter: "blur(1px)", boxShadow: "0 0 130px 24px var(--glow-coral)", animation: "floaty 13s var(--ease) infinite" }} />
        </div>
      )}

      {/* TOP BAR */}
      <header style={{ position: "relative", zIndex: 5, flex: "none", height: 60, display: "flex", alignItems: "center", gap: 18, padding: "0 18px", borderBottom: "1px solid var(--stroke)", background: "var(--panel)", backdropFilter: "blur(22px) saturate(1.4)", WebkitBackdropFilter: "blur(22px) saturate(1.4)", boxShadow: "var(--inset)" }}>
        <a href="/projects" style={{ display: "flex", alignItems: "center", gap: 11, cursor: "pointer" }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(150deg,var(--accent),var(--accent-2))", color: "var(--accent-ink)", fontWeight: 600, fontSize: 13, boxShadow: "var(--inset),0 6px 18px -6px var(--glow-b)" }} className="fg-mono">FG</div>
        </a>
        <div style={{ width: 1, height: 24, background: "var(--stroke)" }} />
        <nav style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "var(--text-3)" }}>
          <a href="/projects" style={{ cursor: "pointer" }}>{projectName}</a>
          <Icon d={["m9 6 6 6-6 6"]} size={15} />
          <span style={{ color: "var(--text)", fontWeight: 500 }}>{cur.label.replace("立项 · ", "").replace(" · 音频", "")}</span>
          <span className="fg-mono" style={{ marginLeft: 6, padding: "2px 8px", borderRadius: 6, border: "1px solid var(--stroke)", fontSize: 10.5, color: "var(--text-2)" }}>阶段 {cur.no} / 07</span>
        </nav>
        <div style={{ flex: 1 }} />
        {saved && (
          <div className="fg-mono" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "var(--text-2)", padding: "5px 11px", borderRadius: 9, background: "var(--panel)", border: "1px solid var(--stroke)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 8px var(--accent)" }} />{saved}
          </div>
        )}
        <Hov as="button" onClick={toggle} title="切换日/夜模式"
          base={{ width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)", transition: "all .35s var(--ease)" }}
          hover={{ color: "var(--text)", background: "var(--panel-2)" }} active={{ transform: "scale(.92)" }}>
          {theme === "dark"
            ? <Icon d={["M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19", "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"]} size={19} />
            : <Icon d={["M21 12.8A8.5 8.5 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8Z"]} size={19} />}
        </Hov>
        <div className="fg-mono" style={{ width: 34, height: 34, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, color: "var(--accent-ink)", background: "linear-gradient(150deg,var(--accent),var(--accent-2))" }}>{avatar}</div>
      </header>

      <div style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0, display: "flex" }}>
        {/* LEFT RAIL */}
        <aside className="fg-rail" style={{ flex: "none", width: 70, display: "flex", flexDirection: "column", alignItems: "center", padding: "14px 0", gap: 6, borderRight: "1px solid var(--stroke)", background: "var(--panel)", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)" }}>
          {STAGES.map((n) => {
            const active = n.key === stageKey;
            return (
              <Hov as="a" key={n.key} href={`/projects/${projectId}/${n.key}`} title={n.label}
                base={{ position: "relative", width: 46, height: 46, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: active ? "var(--accent)" : "var(--text-3)", background: active ? "var(--panel-2)" : "transparent", border: `1px solid ${active ? "var(--stroke-2)" : "transparent"}`, transition: "all .3s var(--ease)" }}
                hover={active ? undefined : { background: "var(--panel-2)", color: "var(--text)" }} active={{ transform: "scale(.9)" }}>
                <div style={{ position: "absolute", left: -14, top: "50%", transform: "translateY(-50%)", width: 3, height: active ? 22 : 0, borderRadius: 3, background: "var(--accent)", boxShadow: "0 0 10px var(--accent)" }} />
                <Icon d={n.d} size={18} />
              </Hov>
            );
          })}
        </aside>

        {/* CENTER */}
        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>{children}</main>

        {/* RIGHT */}
        {right}
      </div>
    </div>
  );
}
