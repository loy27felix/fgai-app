"use client";
import { ReactNode } from "react";
import { useFgTheme, Icon, Hov } from "./ui";

export default function PageShell({ title, email, children }: { title: string; email?: string; children: ReactNode }) {
  const { theme, toggle } = useFgTheme();
  const ini = (email || "?").replace(/@.*/, "").slice(0, 2).toUpperCase();
  return (
    <div data-theme={theme} className="fg2" style={{ position: "relative", minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontSize: 15, lineHeight: 1.55, display: "flex", flexDirection: "column" }}>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}><div style={{ position: "absolute", inset: 0, background: "radial-gradient(700px 540px at 100% 14%, var(--glow-coral), transparent 60%), radial-gradient(760px 600px at 2% -8%, var(--glow-b), transparent 58%)", animation: "glowpulse 16s var(--ease) infinite" }} /></div>
      <header style={{ position: "relative", zIndex: 5, flex: "none", height: 60, display: "flex", alignItems: "center", gap: 16, padding: "0 22px", borderBottom: "1px solid var(--stroke)", background: "var(--panel)", backdropFilter: "blur(22px) saturate(1.4)", WebkitBackdropFilter: "blur(22px) saturate(1.4)", boxShadow: "var(--inset)" }}>
        <a href="/projects" style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <div className="fg-mono" style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: "linear-gradient(150deg,var(--accent),var(--accent-2))", color: "var(--accent-ink)", fontWeight: 600, fontSize: 13, boxShadow: "var(--inset),0 6px 18px -6px var(--glow-b)" }}>FG</div>
        </a>
        <div style={{ width: 1, height: 24, background: "var(--stroke)" }} />
        <nav style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "var(--text-3)" }}>
          <a href="/projects">项目</a>
          <Icon d={["m9 6 6 6-6 6"]} size={15} />
          <span style={{ color: "var(--text)", fontWeight: 500 }}>{title}</span>
        </nav>
        <div style={{ flex: 1 }} />
        <Hov as="button" onClick={toggle} title="日/夜" base={{ width: 38, height: 38, borderRadius: 11, display: "grid", placeItems: "center", cursor: "pointer", color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }} hover={{ color: "var(--text)", background: "var(--panel-2)" }}>
          {theme === "dark" ? <Icon d={["M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19", "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"]} size={19} /> : <Icon d={["M21 12.8A8.5 8.5 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8Z"]} size={19} />}
        </Hov>
        <a href="/projects" style={{ display: "flex", alignItems: "center", gap: 6, height: 38, padding: "0 13px", borderRadius: 11, fontSize: 12.5, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)" }}><Icon d={["m15 6-6 6 6 6"]} size={15} sw={1.7} />返回项目</a>
        <div className="fg-mono" style={{ width: 34, height: 34, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600, color: "var(--accent-ink)", background: "linear-gradient(150deg,var(--accent),var(--accent-2))" }}>{ini}</div>
      </header>
      <main style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0, overflowY: "auto" }}>{children}</main>
    </div>
  );
}
