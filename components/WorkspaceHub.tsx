"use client";

import FGLogo from "@/components/FGLogo";
import { Icon, Hov, useFgTheme } from "@/components/studio/ui";
import { signOut } from "@/app/projects/actions";

type WorkspaceHubProps = { email: string; isAdmin: boolean; projectCount: number };

const WORKSPACES = [
  {
    href: "/projects", number: "01", title: "项目工作区", en: "STORY PRODUCTION",
    description: "从故事圣经、剧本到镜头表，继续推进正在制作的漫剧项目。",
    note: "项目协作 · 制作流程",
    accent: "#7bf1a1", glow: "rgba(73,219,154,.28)",
    icon: ["M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"],
  },
  {
    href: "/creator", number: "02", title: "无限画布", en: "INFINITE CANVAS",
    description: "用图片、视频、文字和 Agent 在同一张画布里持续生成与组织创意。",
    note: "生图 · 生视频 · Agent",
    accent: "#52dfef", glow: "rgba(53,185,238,.30)",
    icon: ["M4 5h16v14H4z", "M8 9h8M8 13h5", "m15 5-3-3-3 3"],
  },
  {
    href: "/presets", number: "03", title: "预设库", en: "PROMPT & SKILLS",
    description: "调用团队沉淀的提示词、风格设定和制作模板，把成熟方法带回创作。",
    note: "提示词 · Skills · 模板",
    accent: "#b4a5ff", glow: "rgba(157,132,255,.30)",
    icon: ["M5 4h14v16H5z", "M8 8h8M8 12h8M8 16h5"],
  },
  {
    href: "/admin", number: "04", title: "管理后台", en: "USAGE & BUDGET",
    description: "查看团队模型消耗、月度额度、制作时长和实际生成记录。",
    note: "用量统计 · 预算控制",
    accent: "#ffb673", glow: "rgba(255,156,95,.27)",
    icon: ["M4 19V9M10 19V5M16 19v-8M22 19V3", "M2 21h20"],
  },
] as const;

export default function WorkspaceHub({ email, isAdmin, projectCount }: WorkspaceHubProps) {
  const { theme, toggle } = useFgTheme();
  const name = email.replace(/@.*/, "") || "创作者";
  const initial = name.slice(0, 2).toUpperCase();

  return (
    <main data-theme={theme} className="fg2" style={{ minHeight: "100dvh", overflow: "hidden", color: "var(--text)", background: "var(--bg)", position: "relative" }}>
      <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{ position: "absolute", width: 640, height: 640, top: -300, left: "5%", borderRadius: "50%", background: "radial-gradient(circle, rgba(28,131,255,.24), transparent 68%)", filter: "blur(20px)" }} />
        <div style={{ position: "absolute", width: 620, height: 620, bottom: -370, right: "-4%", borderRadius: "50%", background: "radial-gradient(circle, rgba(74,236,204,.20), transparent 68%)", filter: "blur(24px)" }} />
        <div style={{ position: "absolute", inset: 0, opacity: theme === "dark" ? .35 : .18, backgroundImage: "linear-gradient(rgba(255,255,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.07) 1px,transparent 1px)", backgroundSize: "42px 42px", maskImage: "linear-gradient(to bottom, black, transparent 72%)" }} />
      </div>

      <header style={{ position: "relative", zIndex: 1, height: 72, display: "flex", alignItems: "center", gap: 15, padding: "0 clamp(18px,4vw,52px)", borderBottom: "1px solid var(--stroke)", background: "color-mix(in srgb,var(--panel-solid) 68%,transparent)", backdropFilter: "blur(18px)" }}>
        <a href="/" aria-label="FG Studio 首页" style={{ display: "flex", alignItems: "center", gap: 10, color: "inherit", textDecoration: "none" }}>
          <FGLogo size={39} />
          <span><strong style={{ display: "block", fontSize: 15, lineHeight: 1.1, letterSpacing: "-.3px" }}>FG Studio</strong><small className="fg-mono" style={{ display: "block", marginTop: 4, color: "var(--text-3)", fontSize: 9, letterSpacing: "1.5px" }}>CREATIVE OPERATING SYSTEM</small></span>
        </a>
        <span className="fg-mono" style={{ marginLeft: 10, color: "var(--text-3)", fontSize: 10, letterSpacing: "1.2px" }}>WORKSPACE SELECTOR</span>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={toggle} title="切换日/夜模式" style={{ width: 38, height: 38, display: "grid", placeItems: "center", borderRadius: 12, cursor: "pointer", color: "var(--text-2)", border: "1px solid var(--stroke)", background: "var(--panel)" }}>
          <Icon d={theme === "dark" ? ["M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19", "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"] : ["M21 12.8A8.5 8.5 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8Z"]} size={18} />
        </button>
        <form action={signOut}><button type="submit" style={{ height: 38, padding: "0 12px", borderRadius: 12, cursor: "pointer", color: "var(--text-2)", border: "1px solid var(--stroke)", background: "var(--panel)", fontSize: 12 }}>退出</button></form>
        <div className="fg-mono" title={email} style={{ width: 38, height: 38, display: "grid", placeItems: "center", borderRadius: "50%", color: "#061725", background: "linear-gradient(140deg,#77f2d4,#5d8dff)", fontSize: 11, fontWeight: 700 }}>{initial}</div>
      </header>

      <section style={{ position: "relative", zIndex: 1, width: "min(1180px,100%)", margin: "0 auto", padding: "clamp(42px,7vh,84px) clamp(20px,4vw,44px) 56px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 28, alignItems: "end", marginBottom: 34 }}>
          <div>
            <div className="fg-mono" style={{ display: "flex", alignItems: "center", gap: 8, color: "#51e7c7", fontSize: 11, letterSpacing: "1.8px" }}><span style={{ width: 7, height: 7, display: "inline-block", borderRadius: "50%", background: "currentColor", boxShadow: "0 0 16px currentColor" }} />FG STUDIO / {new Date().toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</div>
            <h1 style={{ maxWidth: 780, margin: "14px 0 0", fontSize: "clamp(36px,5vw,66px)", lineHeight: .98, letterSpacing: "-3px", fontWeight: 700 }}>今天，从哪一张<br /><span style={{ color: "#66e7d7" }}>工作台</span>开始？</h1>
            <p style={{ maxWidth: 570, margin: "20px 0 0", color: "var(--text-2)", fontSize: 15, lineHeight: 1.75 }}>欢迎回来，{name}。选择你当前要进入的创作空间；项目制作与无限画布彼此独立，又可以共享你的生成资产。</p>
          </div>
          <div style={{ minWidth: 174, padding: "15px 17px", borderRadius: 17, border: "1px solid var(--stroke)", background: "var(--panel)", boxShadow: "var(--inset)" }}>
            <div className="fg-mono" style={{ color: "var(--text-3)", fontSize: 9.5, letterSpacing: "1px" }}>ACTIVE PROJECTS</div>
            <strong className="fg-mono" style={{ display: "block", marginTop: 6, fontSize: 26, color: "var(--text)" }}>{String(projectCount).padStart(2, "0")}</strong>
            <span style={{ display: "block", marginTop: 2, color: "var(--text-2)", fontSize: 11 }}>部项目可继续制作</span>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 16 }} className="fg-workspace-grid">
          {WORKSPACES.map((space, index) => {
            const restricted = space.href === "/admin" && !isAdmin;
            return (
              <Hov key={space.href} as="a" href={space.href} base={{ position: "relative", minHeight: 235, display: "flex", flexDirection: "column", padding: "26px 26px 23px", overflow: "hidden", borderRadius: 23, color: "inherit", textDecoration: "none", border: "1px solid var(--stroke)", background: "linear-gradient(135deg,color-mix(in srgb,var(--panel-solid) 82%,transparent),color-mix(in srgb,var(--panel) 84%,transparent))", boxShadow: "var(--inset),0 24px 50px -38px rgba(0,0,0,.7)", transition: "transform .35s var(--ease-expo), border-color .35s var(--ease-expo), box-shadow .35s var(--ease-expo)" }} hover={{ transform: "translateY(-6px)", borderColor: space.accent, boxShadow: `var(--inset),0 24px 56px -30px ${space.glow}` }}>
                <div aria-hidden style={{ position: "absolute", width: 188, height: 188, top: -85, right: -65, borderRadius: "50%", background: `radial-gradient(circle, ${space.glow}, transparent 68%)`, filter: "blur(4px)" }} />
                <div style={{ display: "flex", position: "relative", alignItems: "flex-start", justifyContent: "space-between", gap: 18 }}>
                  <span className="fg-mono" style={{ color: space.accent, fontSize: 11, letterSpacing: "1.5px" }}>{space.number}</span>
                  <span style={{ width: 45, height: 45, display: "grid", placeItems: "center", borderRadius: 14, color: space.accent, border: `1px solid color-mix(in srgb,${space.accent} 42%,transparent)`, background: `color-mix(in srgb,${space.accent} 10%,transparent)` }}><Icon d={space.icon} size={22} sw={1.5} /></span>
                </div>
                <div style={{ position: "relative", marginTop: "auto" }}>
                  <div className="fg-mono" style={{ color: "var(--text-3)", fontSize: 9.5, letterSpacing: "1.4px" }}>{space.en}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 7 }}><h2 style={{ margin: 0, fontSize: 25, letterSpacing: "-.8px" }}>{space.title}</h2>{restricted ? <span style={{ padding: "3px 7px", borderRadius: 6, color: "var(--text-3)", background: "var(--panel-2)", fontSize: 10 }}>管理员</span> : null}</div>
                  <p style={{ maxWidth: 410, minHeight: 43, margin: "9px 0 0", color: "var(--text-2)", fontSize: 13, lineHeight: 1.65 }}>{space.description}</p>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18, paddingTop: 13, borderTop: "1px solid var(--stroke)", color: "var(--text-3)", fontSize: 11 }}><span>{space.note}</span><span style={{ color: space.accent, fontSize: 17 }}>↗</span></div>
                </div>
              </Hov>
            );
          })}
        </div>
      </section>
      <style jsx>{`@media (max-width:720px){.fg-workspace-grid{grid-template-columns:1fr!important}.fg-workspace-grid>a{min-height:210px!important}}`}</style>
    </main>
  );
}
