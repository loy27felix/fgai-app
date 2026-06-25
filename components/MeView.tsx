import Link from "next/link";

const ROLE_LABEL: Record<string, string> = { user: "成员", admin: "管理员", superadmin: "超级管理员" };

function tally<T>(arr: T[], key: (x: T) => string) {
  const m: Record<string, number> = {};
  for (const x of arr) { const k = key(x) || "—"; m[k] = (m[k] || 0) + 1; }
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

export default function MeView({ email, role, joined, usage, gens, balance }: {
  email: string; role: string; joined: string;
  usage: { model: string; total_tokens: number; created_at: string }[];
  gens: { model: string; kind: string; created_at: string }[];
  balance: string | null;
}) {
  const initial = (email[0] || "U").toUpperCase();
  const calls = usage.length;
  const tokens = usage.reduce((a, u) => a + (u.total_tokens || 0), 0);
  const imgs = gens.length;
  const byText = tally(usage, (u) => u.model);
  const byImg = tally(gens, (g) => g.model);
  const joinedStr = joined ? new Date(joined).toLocaleDateString("zh-CN") : "—";

  return (
    <div className="mx-auto max-w-[900px] px-8 py-8">
      {/* 资料卡 */}
      <div className="relative overflow-hidden rounded-[22px] bg-primary px-7 py-7 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_-20%,rgba(60,224,208,.22),transparent_55%),radial-gradient(circle_at_95%_130%,rgba(255,119,89,.2),transparent_55%)]" />
        <div className="relative flex items-center gap-4">
          <div className="grid h-16 w-16 flex-none place-items-center rounded-2xl bg-white/15 text-[26px] font-bold backdrop-blur ring-1 ring-white/20">{initial}</div>
          <div className="min-w-0">
            <div className="truncate font-disp text-[22px] font-semibold">{email}</div>
            <div className="mt-1 flex items-center gap-2 text-[13px] text-white/70">
              <span className="rounded-pill bg-white/15 px-2.5 py-0.5 font-mono text-[11px]">{ROLE_LABEL[role] || role}</span>
              <span>加入于 {joinedStr}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 用量统计 */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["AI 文本调用", String(calls)], ["消耗 tokens", tokens.toLocaleString()], ["AI 生图次数", String(imgs)], ["团队 DeepSeek 余额", balance || "—"]].map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-stone p-4"><div className="font-mono text-[10.5px] uppercase tracking-wide text-[#75758a]">{k}</div><div className="mt-1 font-disp text-[20px] font-semibold">{v}</div></div>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-muted">注：DeepSeek 余额是团队共用 key 的总额；图片/其它模型走中转站，额度请到中转站后台查看。</p>

      {/* 按模型分布 */}
      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 font-disp text-[15px] font-semibold">文本模型用量</h3>
          {byText.length === 0 ? <p className="text-[13px] text-muted">还没有文本 AI 调用。</p> : (
            <div className="flex flex-col gap-2">
              {byText.map(([m, n]) => (
                <div key={m} className="flex items-center gap-2 text-[13px]">
                  <span className="w-40 flex-none truncate font-mono text-[12px]">{m}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone"><div className="h-full rounded-full bg-green" style={{ width: `${Math.round((n / calls) * 100)}%` }} /></div>
                  <span className="w-8 flex-none text-right font-mono text-[12px] text-muted">{n}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card p-5">
          <h3 className="mb-3 font-disp text-[15px] font-semibold">图片模型用量</h3>
          {byImg.length === 0 ? <p className="text-[13px] text-muted">还没有生图记录。</p> : (
            <div className="flex flex-col gap-2">
              {byImg.map(([m, n]) => (
                <div key={m} className="flex items-center gap-2 text-[13px]">
                  <span className="w-40 flex-none truncate font-mono text-[12px]">{m}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone"><div className="h-full rounded-full bg-coral" style={{ width: `${Math.round((n / imgs) * 100)}%` }} /></div>
                  <span className="w-8 flex-none text-right font-mono text-[12px] text-muted">{n}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/projects" className="pill pill-sm pill-ghost">← 回到项目</Link>
        <Link href="/presets" className="pill pill-sm pill-ghost">浏览预设库 →</Link>
      </div>
    </div>
  );
}
