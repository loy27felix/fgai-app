"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const ROT = ["剧组", "工作流", "宇宙", "Agent", "片场"];
const WORKS = ["狼和七只小山羊", "侏儒怪", "大拇指汤姆", "画眉嘴国王", "快乐王子与列那狐", "瓶中精灵"];

function Arrow() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>; }
function ILayers() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></svg>; }
function IMemory() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" /></svg>; }
function IPlug() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v5" /></svg>; }
function ILock() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>; }

function CTA({ href, label, solid, onClick }: { href?: string; label: string; solid?: boolean; onClick?: () => void }) {
  const cls = `group inline-flex items-center gap-3 rounded-full py-2 pl-6 pr-2 text-[14px] font-medium transition-all duration-500 ease-[cubic-bezier(.32,.72,0,1)] active:scale-[.98] ${solid ? "bg-white text-[#0a0f24]" : "border border-white/20 text-white hover:bg-white/8"}`;
  const inner = (<>{label}<span className={`grid h-8 w-8 place-items-center rounded-full transition duration-500 ease-[cubic-bezier(.32,.72,0,1)] group-hover:translate-x-0.5 ${solid ? "bg-[#0a0f24]/10" : "bg-white/12"}`}><Arrow /></span></>);
  return onClick ? <button onClick={onClick} className={cls}>{inner}</button> : <Link href={href || "#"} className={cls}>{inner}</Link>;
}

const BENTO = [
  { i: <ILayers />, span: "md:col-span-4", h: "统一工作流", p: "立项 → 剧本 → 资产 → 分镜 → 逐镜头 → 生视频 → BGM → 拼接，把散在十个工具里的活，收进一条标准化又留足人工干预的链路。" },
  { i: <IMemory />, span: "md:col-span-2", h: "带记忆的 Agent", p: "一个故事 = 一个项目 = 一个 Agent。故事圣经锁住画风、世界观、人物与比例。" },
  { i: <ILock />, span: "md:col-span-3", h: "角色一致性", p: "锁定一张标准脸，分镜与关键帧出场该角色时自动作参考图，跨镜头同一张脸。" },
  { i: <IPlug />, span: "md:col-span-3", h: "接好的 AI", p: "文本、生图、生视频、配乐多模型可选，公司统一 Key，也能接自己的。" },
];
const FLOW: [string, string, string][] = [
  ["01", "立项 & 故事圣经", "AI 破题对话定方向，确认后写入全局记忆并锁定。"],
  ["02", "剧本工作台", "对话生成 + 版本保存 + 剧本医生评分 + 宫格体检。"],
  ["03", "资产库", "对话式 / 画布式生图，人物服装道具场景统一管理，可锁脸。"],
  ["04", "导演分镜表", "拆镜头、子分镜切镜、一键出分镜参考图。"],
  ["05", "逐镜头设计", "关键帧生成、走位比例、视频 Prompt（含详细分镜格式）。"],
  ["06", "生视频", "物料打包，跳转外部平台生成，回填成片链接。"],
  ["07", "BGM / 音频", "基于圣经生成 Suno 配乐方案。"],
  ["08", "拼接 & 导出", "成片清单、完成度统计、ffmpeg 拼接命令。"],
];
const STATS: [string, string][] = [["08", "制作阶段"], ["06", "图像模型"], ["169", "内置预设"], ["1-click", "拼接导出"]];

export default function Landing() {
  const [ri, setRi] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const supabase = createClient();
  const [authed, setAuthed] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  function enter() { if (authed) router.push("/projects"); else { setMsg(""); setShowLogin(true); } }
  async function submit() {
    setMsg(""); const e = email.trim().toLowerCase();
    if (pw.length < 6) { setMsg("密码至少 6 位"); return; }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email: e, password: pw });
        if (error) throw error;
        const { data } = await supabase.auth.getSession();
        if (data.session) router.replace("/projects"); else setMsg("注册成功，请到邮箱点确认链接后再登录。");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: e, password: pw });
        if (error) throw error; router.replace("/projects");
      }
    } catch (err: any) { setMsg(err?.message || "出错了，请重试"); } finally { setBusy(false); }
  }
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
    const t = setInterval(() => setRi((i) => (i + 1) % ROT.length), 2300);
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("in")), { threshold: 0.14 });
    rootRef.current?.querySelectorAll(".rv").forEach((el) => io.observe(el));
    return () => { clearInterval(t); io.disconnect(); };
  }, []);

  return (
    <div ref={rootRef} className="min-h-screen bg-[#f4f3ef] text-[#15151a] transition-colors dark:bg-[#08080b] dark:text-white">
      <div className="grain pointer-events-none fixed inset-0 z-[60]" />

      {/* 悬浮玻璃胶囊导航 */}
      <nav className="fixed inset-x-0 top-5 z-50 flex justify-center px-4">
        <div className="flex w-full max-w-[920px] items-center gap-3 rounded-full border border-black/8 bg-white/70 px-4 py-2 backdrop-blur-xl dark:border-white/10 dark:bg-white/[.06]">
          <div className="flex items-center gap-2 pl-1 font-disp text-[15px] font-semibold tracking-tight">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-[#34d399] text-[10px] font-bold text-[#0a0f24]">FG</span>
            FG Studio
          </div>
          <div className="mx-auto hidden gap-6 text-[13px] text-black/55 dark:text-white/55 sm:flex">
            <a href="#cap" className="transition hover:text-current">能力</a>
            <a href="#flow" className="transition hover:text-current">工作流</a>
            <Link href="/presets" className="transition hover:text-current">预设库</Link>
          </div>
          <ThemeToggle />
          <button onClick={enter} className="group ml-1 inline-flex items-center gap-2 rounded-full bg-[#15151a] py-1.5 pl-4 pr-1.5 text-[13px] font-medium text-white transition active:scale-[.98] dark:bg-white dark:text-[#0a0f24]">
            进入<span className="grid h-6 w-6 place-items-center rounded-full bg-white/15 transition group-hover:translate-x-0.5 dark:bg-black/10"><Arrow /></span>
          </button>
        </div>
      </nav>

      {/* HERO — ORBIS 梦幻天空（双模式恒为梦幻夜空，白字）*/}
      <header className="relative flex min-h-[100dvh] items-center overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-[#0a0f28]" />
          <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_18%_8%,rgba(80,110,220,.55),transparent_60%),radial-gradient(55%_45%_at_88%_22%,rgba(214,150,190,.45),transparent_60%),radial-gradient(70%_60%_at_50%_115%,rgba(120,210,205,.4),transparent_60%)]" />
          <video className="absolute inset-0 h-full w-full object-cover opacity-40" autoPlay muted loop playsInline onError={(e) => ((e.target as HTMLVideoElement).style.display = "none")}>
            <source src="/hero-bg.mp4" type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_72%_35%,transparent,rgba(10,15,40,.55)_62%,rgba(10,15,40,.85))]" />
          <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-b from-transparent to-[#f4f3ef] dark:to-[#08080b]" />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-[1280px] px-6 text-white">
          <div className="max-w-[820px] pt-20">
            <div className="mb-7 inline-flex items-center gap-2.5 rounded-full border border-white/14 bg-white/8 px-3.5 py-1.5 backdrop-blur">
              <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#34d399] opacity-70" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#34d399]" /></span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/70">FableGlitch · AI MANGA STUDIO</span>
            </div>
            <h1 className="font-disp text-[clamp(42px,7.4vw,92px)] font-semibold leading-[0.94] tracking-tighter">
              一个故事，<br />一个会记忆的<br />
              <span className="text-white/30">( </span><span className="text-[#5fe3c0]">{ROT[ri]}</span><span className="text-white/30"> )</span>。
            </h1>
            <p className="mt-7 max-w-[54ch] text-[clamp(15px,1.5vw,18px)] leading-relaxed text-white/60">
              把剧本、资产、分镜、镜头、成片的整条影视工业流程，搬进一个会协作、带记忆、接好 AI 的工作台。从一句灵感，到一部 AI 漫剧。
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <CTA onClick={enter} label="进入工作台" solid />
              <CTA href="#flow" label="看完整工作流" />
            </div>
            <div className="mt-14 flex flex-wrap gap-x-10 gap-y-3 border-t border-white/12 pt-6">
              {STATS.map(([v, l]) => (<div key={l}><div className="font-mono text-[22px] font-medium tracking-tight">{v}</div><div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-white/45">{l}</div></div>))}
            </div>
          </div>
        </div>
      </header>

      {/* MARQUEE */}
      <div className="overflow-hidden border-y border-black/8 py-5 dark:border-white/8">
        <div className="[mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
          <div className="marquee-track gap-10">
            {[...WORKS, ...WORKS].map((w, i) => (<span key={i} className="flex items-center gap-10 whitespace-nowrap font-disp text-[clamp(18px,2.2vw,28px)] font-medium tracking-tight text-black/35 dark:text-white/35">{w}<span className="text-[#34d399]/70">/</span></span>))}
          </div>
        </div>
      </div>

      {/* CAPABILITIES — Bento with double-bezel */}
      <section id="cap" className="mx-auto max-w-[1280px] px-6 py-32">
        <div className="rv mb-14 max-w-[760px]">
          <span className="inline-block rounded-full border border-black/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[#1d9e75] dark:border-white/12">为什么用 FG Studio</span>
          <h2 className="mt-5 font-disp text-[clamp(28px,4.2vw,54px)] font-semibold leading-[1.03] tracking-tighter">把散落在十个工具里的活，收进一个工作台。</h2>
        </div>
        <div className="rv grid grid-cols-1 gap-4 md:grid-cols-6">
          {BENTO.map((c) => (
            <div key={c.h} className={`rounded-[2rem] border border-black/6 bg-black/[.025] p-1.5 ring-1 ring-black/5 transition duration-500 ease-[cubic-bezier(.32,.72,0,1)] hover:-translate-y-1 dark:border-white/8 dark:bg-white/[.03] dark:ring-white/8 ${c.span}`}>
              <div className="h-full rounded-[calc(2rem-0.375rem)] bg-white p-7 shadow-[inset_0_1px_0_rgba(255,255,255,.7)] dark:bg-white/[.02] dark:shadow-[inset_0_1px_0_rgba(255,255,255,.06)]">
                <div className="grid h-11 w-11 place-items-center rounded-xl border border-black/8 bg-[#34d399]/10 text-[#1d9e75] dark:border-white/10 dark:text-[#5fe3c0]">{c.i}</div>
                <h3 className="mt-5 font-disp text-[21px] font-semibold tracking-tight">{c.h}</h3>
                <p className="mt-2.5 max-w-[46ch] text-[14px] leading-relaxed text-black/55 dark:text-white/50">{c.p}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* WORKFLOW — divided list */}
      <section id="flow" className="border-y border-black/8 bg-black/[.015] dark:border-white/8 dark:bg-white/[.015]">
        <div className="mx-auto max-w-[1280px] px-6 py-32">
          <div className="rv mb-12 flex flex-wrap items-end justify-between gap-4">
            <h2 className="max-w-[620px] font-disp text-[clamp(26px,3.6vw,46px)] font-semibold leading-[1.05] tracking-tighter">从剧本到成片，一条链路跑通。</h2>
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-black/40 dark:text-white/40">8 STAGES</span>
          </div>
          <div className="rv divide-y divide-black/8 border-t border-black/8 dark:divide-white/8 dark:border-white/8">
            {FLOW.map(([n, t, d]) => (
              <div key={n} className="group grid grid-cols-[auto_1fr] items-start gap-x-6 py-6 md:grid-cols-[auto_minmax(0,300px)_1fr] md:items-center">
                <span className="font-mono text-[13px] text-[#1d9e75]/90 dark:text-[#5fe3c0]/80">{n}</span>
                <span className="font-disp text-[clamp(18px,2vw,24px)] font-medium tracking-tight transition duration-500 ease-[cubic-bezier(.32,.72,0,1)] group-hover:translate-x-1.5">{t}</span>
                <span className="col-start-2 mt-1 text-[14px] leading-snug text-black/50 dark:text-white/45 md:col-start-3 md:mt-0">{d}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA — double-bezel */}
      <section className="mx-auto max-w-[1280px] px-6 py-32">
        <div className="rv rounded-[2.4rem] border border-black/6 bg-black/[.025] p-1.5 ring-1 ring-black/5 dark:border-white/8 dark:bg-white/[.03] dark:ring-white/8">
          <div className="relative overflow-hidden rounded-[calc(2.4rem-0.375rem)] bg-[#0a0f28] px-8 py-24 text-center text-white md:px-14">
            <div className="absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_-10%,rgba(95,227,192,.22),transparent_60%),radial-gradient(50%_60%_at_20%_120%,rgba(120,140,230,.25),transparent_60%)]" />
            <h2 className="relative font-disp text-[clamp(30px,5vw,62px)] font-semibold leading-[0.98] tracking-tighter">开始做点好东西。</h2>
            <p className="relative mx-auto mt-5 max-w-[46ch] text-[16px] leading-relaxed text-white/60">登录 FG Studio，把你的下一部 AI 漫剧从灵感一路做到成片。</p>
            <div className="relative mt-9 flex justify-center"><CTA onClick={enter} label="进入工作台" solid /></div>
          </div>
        </div>
      </section>

      <footer className="border-t border-black/8 dark:border-white/8">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-6 px-6 py-10 text-[13px] text-black/45 dark:text-white/40">
          <span className="font-disp text-[15px] font-semibold text-current">FG Studio</span>
          <span>AI 漫剧制作平台 · 内部工具 · 仅限 @beva.com</span>
          <span>© 2026 FableGlitch</span>
        </div>
      </footer>

      {showLogin && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-[#06060a]/75 p-5 backdrop-blur-md" onClick={() => !busy && setShowLogin(false)}>
          <div className="w-[420px] max-w-full rounded-[24px] border border-white/12 bg-white/[.05] p-8 text-white shadow-[0_30px_80px_-30px_rgba(0,0,0,.8)] backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[#5fe3c0]">FableGlitch · AI MANGA STUDIO</div>
            <h3 className="font-disp text-[24px] font-semibold tracking-tight">{mode === "signin" ? "登录工作台" : "注册账号"}</h3>
            <p className="mb-6 mt-1.5 text-[13px] text-white/50">用公司邮箱开始你的 AI 漫剧项目。</p>
            <input className="mb-3 w-full rounded-xl border border-white/12 bg-white/[.05] px-3.5 py-3 text-[15px] text-white outline-none transition placeholder:text-white/30 focus:border-[#5fe3c0] focus:bg-white/[.08]" value={email} placeholder="yourname@beva.com" onChange={(ev) => setEmail(ev.target.value)} />
            <input className="mb-2 w-full rounded-xl border border-white/12 bg-white/[.05] px-3.5 py-3 text-[15px] text-white outline-none transition placeholder:text-white/30 focus:border-[#5fe3c0] focus:bg-white/[.08]" type="password" value={pw} placeholder="密码（至少 6 位）" onChange={(ev) => setPw(ev.target.value)} onKeyDown={(ev) => ev.key === "Enter" && submit()} />
            {msg && <div className="mb-2 text-[13px] font-medium text-[#ff9b85]">{msg}</div>}
            <button className="mt-3 w-full rounded-full bg-[#34d399] py-3 text-[14px] font-semibold text-[#0a2018] transition hover:brightness-105 active:scale-[.98] disabled:opacity-60" disabled={busy} onClick={submit}>{busy ? "处理中…" : mode === "signin" ? "登录" : "注册并登录"}</button>
            <div className="mt-5 text-center text-[13px] text-white/55">{mode === "signin" ? "还没有账号？" : "已有账号？"}{" "}
              <button className="font-medium text-[#5fe3c0] hover:underline" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMsg(""); }}>{mode === "signin" ? "去注册" : "去登录"}</button>
            </div>
            <p className="mt-5 border-t border-white/8 pt-4 text-[12px] leading-relaxed text-white/40">仅限 <b className="text-[#5fe3c0]">@beva.com</b> 或已审批白名单邮箱，其他邮箱请联系管理员。</p>
          </div>
        </div>
      )}
    </div>
  );
}
