"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import FGLogo from "@/components/FGLogo";
import { createClient } from "@/lib/supabase/client";
import { companyEmailFromUsername, normalizeCompanyUsername } from "@/lib/auth/company-email";

const STAGES = [
  ["01", "故事与剧本", "从灵感、剧本到角色圣经"],
  ["02", "无限画布", "把图片、镜头与视频连成一条线"],
  ["03", "导演分镜", "让画面、动作与节奏可被协作"],
  ["04", "生成与资产", "调模型、看用量、沉淀为可复用资产"],
];

function Arrow() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
}

function Spark() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2l1.85 6.15L20 10l-6.15 1.85L12 18l-1.85-6.15L4 10l6.15-1.85L12 2Z" /><path d="m19 16 .72 2.28L22 19l-2.28.72L19 22l-.72-2.28L16 19l2.28-.72L19 16Z" /></svg>;
}

export default function Landing() {
  const router = useRouter();
  const supabase = createClient();
  const [authed, setAuthed] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { supabase.auth.getSession().then(({ data }) => setAuthed(Boolean(data.session))); }, [supabase]);
  useEffect(() => {
    if (!showAuth) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [showAuth]);

  function enterWorkspace() {
    if (authed) router.push("/workspace");
    else { setMessage(""); setShowAuth(true); }
  }

  async function submit() {
    setMessage("");
    const companyEmail = mode === "signup" ? companyEmailFromUsername(username) : email.trim().toLowerCase();
    if (!companyEmail) { setMessage("请输入 @beva.com 前的用户名，例如 meilinte。"); return; }
    if (password.length < 6) { setMessage("密码至少需要 6 位。"); return; }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email: companyEmail, password });
        if (error) throw error;
        const { data } = await supabase.auth.getSession();
        if (data.session) router.replace("/workspace");
        else setMessage("注册成功，请到公司邮箱完成验证后再登录。");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: companyEmail, password });
        if (error) throw error;
        router.replace("/workspace");
      }
    } catch (error: any) { setMessage(error?.message || "暂时无法完成操作，请稍后再试。"); }
    finally { setBusy(false); }
  }

  return (
    <main className="fg-home min-h-screen overflow-x-clip bg-[#f7f4ec] text-[#101114]">
      <section className="mx-auto min-h-[100dvh] max-w-[1536px] px-2 pb-2 pt-2 sm:px-4 sm:pb-4 sm:pt-4">
        <div className="relative flex min-h-[calc(100dvh-16px)] flex-col overflow-hidden rounded-[30px] bg-[#e50059] px-5 pb-7 pt-5 text-white shadow-[0_26px_90px_rgba(118,0,48,.25)] sm:min-h-[calc(100dvh-32px)] sm:rounded-[40px] sm:px-9 sm:pb-10 sm:pt-7 lg:px-12">
          <div className="pointer-events-none absolute inset-0 opacity-45 [background-image:radial-gradient(rgba(255,255,255,.28)_1px,transparent_1px)] [background-size:18px_18px]" />
          <div className="pointer-events-none absolute -left-[12%] top-[13%] h-[72%] w-[74%] rotate-[-16deg] rounded-full border-[42px] border-white/[.09]" />
          <div className="pointer-events-none absolute -right-[15%] -top-[38%] h-[90%] w-[73%] rounded-full bg-[#ff7bad]/25 blur-3xl" />
          <p className="pointer-events-none absolute left-[3%] top-[15%] max-w-[13ch] select-none font-disp text-[clamp(58px,12vw,210px)] font-semibold leading-[.72] tracking-[-.09em] text-white/[.11] sm:left-[8%]">FABLE<br />GLITCH</p>

          <nav className="relative z-20 flex items-center justify-between gap-4">
            <Link href="/" className="inline-flex items-center gap-2.5 text-[13px] font-medium tracking-tight" aria-label="FG Studio 首页"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white p-1.5 shadow-[0_6px_22px_rgba(52,0,25,.18)]"><FGLogo size={26} /></span><span className="hidden leading-tight sm:block">FG STUDIO<br /><span className="font-mono text-[8px] tracking-[.18em] text-white/65">FILM AT SCALE</span></span></Link>
            <div className="hidden items-center gap-6 text-[11px] font-medium text-white/75 md:flex"><a href="#tools" className="transition hover:text-white">工作入口</a><a href="#method" className="transition hover:text-white">创作方式</a><Link href="/presets" className="transition hover:text-white">预设与提示词</Link></div>
            <div className="flex items-center gap-2"><ThemeToggle /><button onClick={enterWorkspace} className="group inline-flex items-center gap-2 rounded-full bg-white py-2 pl-4 pr-2 text-[12px] font-semibold text-[#17131b] transition hover:scale-[1.025] active:scale-[.98]">{authed ? "进入工作区" : "登录"}<span className="grid h-6 w-6 place-items-center rounded-full bg-[#e50059] text-white transition group-hover:translate-x-0.5"><Arrow /></span></button></div>
          </nav>

          <div className="relative z-10 flex flex-1 items-center py-12 sm:py-16 lg:py-10"><div className="w-full"><div className="max-w-[620px] animate-[fg-home-rise_.7s_cubic-bezier(.16,1,.3,1)_both]"><div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/35 bg-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.16em] text-white/85 backdrop-blur-md"><span className="h-1.5 w-1.5 rounded-full bg-[#7effd4] shadow-[0_0_12px_#7effd4]" /> AI film production workspace</div><h1 className="font-disp text-[clamp(58px,10.4vw,164px)] font-semibold leading-[.74] tracking-[-.075em] sm:leading-[.72]">MAKE<br /><span className="ml-[.17em] text-white/30">WORLDS</span><br />MOVE.</h1><p className="mt-9 max-w-[42ch] text-[14px] leading-relaxed text-white/80 sm:text-[16px]">FG Studio 把故事、角色、分镜、无限画布和生成模型放在同一张创作地图里。不是多一个工具，而是把制作过程真正连起来。</p><div className="mt-7 flex flex-wrap gap-3"><button onClick={enterWorkspace} className="group inline-flex items-center gap-3 rounded-full bg-[#101114] px-5 py-3 text-[13px] font-semibold text-white transition hover:bg-black hover:shadow-xl active:scale-[.98]">开始一个项目 <span className="transition group-hover:translate-x-1"><Arrow /></span></button><Link href="/creator#/canvas" className="inline-flex items-center gap-2 rounded-full border border-white/45 bg-white/[.08] px-5 py-3 text-[13px] font-medium backdrop-blur transition hover:bg-white/15"><Spark /> 打开无限画布</Link></div></div></div></div>

          <div className="pointer-events-none absolute bottom-0 right-[-9%] z-[5] h-[78%] w-[78%] animate-[fg-home-rise_.9s_.1s_cubic-bezier(.16,1,.3,1)_both] sm:right-[-5%] sm:h-[86%] sm:w-[68%] lg:right-[1%] lg:w-[58%]"><img src="/fg-night-fox.png" alt="FG Studio 夜航狐角色" className="h-full w-full object-contain object-bottom" /></div>
          <div className="relative z-10 flex items-end justify-between gap-5 border-t border-white/25 pt-4 text-[10px] font-mono uppercase tracking-[.14em] text-white/70"><span>01 — Imagine, structure, make.</span><span className="hidden sm:block">FABLEGLITCH / FG STUDIO / 2026</span></div>
        </div>
      </section>

      <section id="tools" className="mx-auto max-w-[1536px] px-2 py-2 sm:px-4 sm:py-4"><div className="relative overflow-hidden rounded-[30px] bg-[#f0edff] px-5 py-12 text-[#12121a] sm:rounded-[40px] sm:px-10 sm:py-16 lg:min-h-[760px] lg:px-16 lg:py-20"><div className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(18,18,26,.055)_1px,transparent_1px),linear-gradient(90deg,rgba(18,18,26,.055)_1px,transparent_1px)] [background-size:34px_34px]" /><div className="relative z-10 flex max-w-[600px] flex-col items-start"><p className="font-mono text-[11px] uppercase tracking-[.16em] text-[#575573]">Work without the hand-off.</p><h2 className="mt-5 font-disp text-[clamp(42px,7.4vw,108px)] font-semibold leading-[.82] tracking-[-.07em]">一张桌子，<br />从灵感做到<br /><span className="text-[#e50059]">成片。</span></h2><p className="mt-7 max-w-[39ch] text-[15px] leading-relaxed text-[#4d4a61]">不需要先开导演项目才能使用模型；但当你需要协作时，所有结果都能回到项目、镜头和资产库。</p><div className="mt-9 grid w-full max-w-[485px] gap-2.5">{[["01", "无限画布", "把参考、文字、图片和视频连起来"], ["02", "导演项目", "从剧本到逐镜头设计"], ["03", "模型工作台", "对话、生图、生视频与用量"]].map(([no, title, desc]) => (<Link key={no} href={title === "无限画布" ? "/creator#/canvas" : title === "导演项目" ? "/workspace" : "/creator"} className="group flex items-center gap-4 rounded-2xl border border-[#151323]/10 bg-white/90 px-4 py-4 shadow-[0_12px_30px_rgba(37,26,80,.07)] transition hover:-translate-y-0.5 hover:border-[#e50059]/40"><span className="font-mono text-[10px] text-[#e50059]">{no}</span><span className="min-w-0 flex-1"><b className="block text-[15px]">{title}</b><small className="mt-0.5 block text-[12px] text-[#6a6679]">{desc}</small></span><span className="text-[#e50059] transition group-hover:translate-x-1"><Arrow /></span></Link>))}</div></div><div className="pointer-events-none absolute bottom-[-12%] right-[-21%] h-[82%] w-[78%] sm:right-[-10%] sm:w-[60%] lg:bottom-[-6%] lg:right-[-4%] lg:h-[94%] lg:w-[52%]"><img src="/fg-night-fox.png" alt="" className="h-full w-full object-contain object-bottom [filter:drop-shadow(0_30px_24px_rgba(37,20,75,.25))]" /></div><span className="pointer-events-none absolute right-[8%] top-[11%] select-none font-disp text-[clamp(74px,13vw,190px)] font-semibold leading-none tracking-[-.1em] text-[#e50059]/[.09]">FG</span></div></section>

      <section id="method" className="mx-auto max-w-[1536px] px-2 py-2 sm:px-4 sm:py-4"><div className="relative overflow-hidden rounded-[30px] bg-[#0c0d10] px-5 py-12 text-white sm:rounded-[40px] sm:px-10 sm:py-16 lg:min-h-[730px] lg:px-16 lg:py-20"><div className="pointer-events-none absolute inset-0 opacity-70 [background-image:radial-gradient(rgba(255,255,255,.35)_1px,transparent_1px)] [background-size:16px_16px]" /><div className="relative z-10 max-w-[710px]"><p className="font-mono text-[11px] uppercase tracking-[.17em] text-[#60e5ff]">A production system with a memory.</p><h2 className="mt-5 font-disp text-[clamp(38px,6.3vw,94px)] font-semibold leading-[.84] tracking-[-.075em]">让每一次<br /><span className="text-white/35">好结果</span>留下来。</h2><p className="mt-8 max-w-[48ch] text-[15px] leading-relaxed text-white/68">角色设定、镜头语言、提示词和生成资产不该散落在聊天记录里。FG 的工作方式，是让下一次创作从已经验证过的结果开始。</p><div className="mt-10 divide-y divide-white/15 border-y border-white/15">{STAGES.map(([no, title, desc]) => (<div key={no} className="group grid grid-cols-[auto_1fr_auto] items-center gap-4 py-4 sm:grid-cols-[64px_190px_1fr]"><span className="font-mono text-[11px] text-[#60e5ff]">{no}</span><b className="font-disp text-[18px] font-medium tracking-tight">{title}</b><span className="hidden text-[13px] text-white/55 sm:block">{desc}</span><span className="text-white/35 transition group-hover:translate-x-1 group-hover:text-[#60e5ff]"><Arrow /></span></div>))}</div><button onClick={enterWorkspace} className="mt-10 inline-flex items-center gap-3 rounded-full bg-[#60e5ff] px-5 py-3 text-[13px] font-semibold text-[#06151b] transition hover:brightness-110 active:scale-[.98]">进入你的工作区 <Arrow /></button></div><div className="pointer-events-none absolute bottom-[-9%] right-[-26%] hidden h-[100%] w-[68%] opacity-90 lg:block"><img src="/fg-night-fox.png" alt="" className="h-full w-full object-contain object-bottom [filter:grayscale(.6)_contrast(1.16)_drop-shadow(0_0_54px_rgba(96,229,255,.24))]" /></div><div className="relative z-10 mt-20 border-t border-white/15 pt-5 text-[11px] text-white/40 sm:mt-24">FG STUDIO · Internal creative infrastructure · @beva.com</div></div></section>

      <footer className="mx-auto flex max-w-[1536px] flex-wrap items-center justify-between gap-3 px-7 py-8 text-[11px] text-[#6c6873] sm:px-10"><span className="inline-flex items-center gap-2 font-medium text-[#24212d]"><FGLogo size={22} /> FG STUDIO</span><span>FableGlitch AI production workspace</span><Link href="/login" className="transition hover:text-[#e50059]">登录工作区 <span aria-hidden="true">↗</span></Link></footer>

      {showAuth && <div className="fixed inset-0 z-[100] grid place-items-center bg-[#08080c]/75 p-5 backdrop-blur-md" onClick={() => !busy && setShowAuth(false)}><div className="w-[420px] max-w-full rounded-[25px] border border-white/15 bg-[#17171f]/95 p-7 text-white shadow-[0_30px_80px_rgba(0,0,0,.55)]" onClick={(event) => event.stopPropagation()}><div className="mb-5 flex items-start justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-[.18em] text-[#60e5ff]">FG STUDIO / ACCESS</div><h3 className="mt-2 font-disp text-[25px] font-semibold tracking-tight">{mode === "signin" ? "登录工作区" : "注册账号"}</h3></div><button onClick={() => !busy && setShowAuth(false)} className="grid h-8 w-8 place-items-center rounded-full border border-white/15 text-white/65 transition hover:bg-white/10 hover:text-white" aria-label="关闭">×</button></div>{mode === "signup" ? <div className="mb-3 flex overflow-hidden rounded-xl border border-white/15 bg-white/[.05] focus-within:border-[#60e5ff]"><input className="min-w-0 flex-1 bg-transparent px-3.5 py-3 text-[15px] text-white outline-none placeholder:text-white/35" value={username} placeholder="例如：meilinte" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => setUsername(normalizeCompanyUsername(event.target.value))} /><span className="flex items-center border-l border-white/10 px-3 text-[13px] text-[#60e5ff]">@beva.com</span></div> : <input className="mb-3 w-full rounded-xl border border-white/15 bg-white/[.05] px-3.5 py-3 text-[15px] text-white outline-none placeholder:text-white/35 focus:border-[#60e5ff]" value={email} placeholder="yourname@beva.com" autoCapitalize="none" onChange={(event) => setEmail(event.target.value)} />}<input className="w-full rounded-xl border border-white/15 bg-white/[.05] px-3.5 py-3 text-[15px] text-white outline-none placeholder:text-white/35 focus:border-[#60e5ff]" type="password" value={password} placeholder="密码（至少 6 位）" onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submit()} />{message && <p className="mt-3 text-[13px] leading-relaxed text-[#ffb0c4]">{message}</p>}<button disabled={busy} onClick={submit} className="mt-4 w-full rounded-full bg-[#60e5ff] py-3 text-[14px] font-semibold text-[#08161d] transition hover:brightness-110 disabled:opacity-55">{busy ? "处理中…" : mode === "signin" ? "登录" : "注册并登录"}</button><p className="mt-5 text-center text-[13px] text-white/55">{mode === "signin" ? "还没有账号？" : "已有账号？"} <button className="font-medium text-[#60e5ff] hover:underline" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); }}>{mode === "signin" ? "去注册" : "去登录"}</button></p><p className="mt-5 border-t border-white/10 pt-4 text-[11px] leading-relaxed text-white/40">注册仅允许公司 <b className="text-[#60e5ff]">@beva.com</b> 邮箱。</p></div></div>}
    </main>
  );
}
