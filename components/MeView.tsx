"use client";
import PageShell from "@/components/studio/PageShell";

const ROLE_LABEL: Record<string, string> = { user: "成员", admin: "管理员", superadmin: "超级管理员" };
function tally<T>(arr: T[], key: (x: T) => string) { const m: Record<string, number> = {}; for (const x of arr) { const k = key(x) || "—"; m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]); }

export default function MeView({ email, role, joined, usage, gens, balance }: {
  email: string; role: string; joined: string; usage: any[]; gens: any[]; balance: string | null;
}) {
  const tokens = usage.reduce((s, u) => s + (u.total_tokens || 0), 0);
  const byModel = tally(gens, (g) => g.model || "?");
  const stat = (l: string, v: string, accent?: boolean) => (
    <div style={{ flex: 1, minWidth: 150, padding: "16px 18px", borderRadius: 16, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>
      <div className="fg-mono" style={{ fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)", textTransform: "uppercase" }}>{l}</div>
      <div className="fg-mono" style={{ marginTop: 6, fontSize: 26, fontWeight: 600, color: accent ? "var(--accent)" : "var(--text)" }}>{v}</div>
    </div>
  );
  return (
    <PageShell title="个人中心" email={email}>
      <div style={{ maxWidth: 920, margin: "0 auto", padding: "30px 30px 70px", animation: "blurUp .5s var(--ease) both" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "22px 24px", borderRadius: 20, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset),var(--shadow)", marginBottom: 22 }}>
          <div className="fg-mono" style={{ width: 56, height: 56, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 20, fontWeight: 600, color: "var(--accent-ink)", background: "linear-gradient(150deg,var(--accent),var(--accent-2))" }}>{(email || "?").slice(0, 2).toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{email}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
              <span style={{ fontSize: 11.5, color: "var(--accent)", padding: "2px 9px", borderRadius: 7, background: "var(--user-bubble)", border: "1px solid var(--user-stroke)" }}>{ROLE_LABEL[role] || role}</span>
              {joined && <span className="fg-mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>加入于 {new Date(joined).toLocaleDateString("zh-CN")}</span>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 22 }}>
          {stat("AI 调用次数", String(usage.length))}
          {stat("AI 总 tokens", tokens.toLocaleString())}
          {stat("出图次数", String(gens.length), true)}
          {stat("DeepSeek 余额", balance || "—")}
        </div>
        <div style={{ padding: "18px 20px", borderRadius: 16, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>出图 · 按模型</div>
          {byModel.length === 0 ? <div style={{ color: "var(--text-3)", fontSize: 13 }}>暂无出图记录</div> :
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{byModel.map(([m, n]) => <span key={m} className="fg-mono" style={{ fontSize: 12, color: "var(--text-2)", padding: "5px 11px", borderRadius: 9, background: "var(--bg-2)", border: "1px solid var(--stroke)" }}>{m} · {n}</span>)}</div>}
        </div>
      </div>
    </PageShell>
  );
}
