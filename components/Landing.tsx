"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import FGLogo from "@/components/FGLogo";
import ThemeToggle from "@/components/ThemeToggle";
import { companyEmailFromUsername, normalizeCompanyUsername } from "@/lib/auth/company-email";
import { createClient } from "@/lib/supabase/client";

const ParticleText: any = dynamic(() => import("@/components/react-bits/ParticleText"), { ssr: false });
const EchoText: any = dynamic(() => import("@/components/react-bits/EchoText"), { ssr: false });
const DepthText: any = dynamic(() => import("@/components/react-bits/DepthText"), { ssr: false });
const SpecularButton: any = dynamic(() => import("@/components/react-bits/SpecularButton"), { ssr: false });
const LiquidEther: any = dynamic(() => import("@/components/react-bits/LiquidEther"), { ssr: false });

// A local loop ships with the product. An optional public CDN/OSS URL can
// replace it later without changing the composition or the still fallback.
const HERO_VIDEO_SRC = process.env.NEXT_PUBLIC_FG_HERO_VIDEO_SRC?.trim() || "/fg-cat-director-loop.mp4";

const WORKSPACES = [
  ["01", "无限画布", "把参考、文本、图片与视频连接成可继续生长的画面。", "/creator#/canvas"],
  ["02", "导演项目", "从剧本到逐镜设计，让团队的叙事和镜头保持在同一条线上。", "/workspace"],
  ["03", "模型工作台", "用对话、生图、生视频和用量管理，完成最后一公里。", "/creator"],
];

const PIPELINE = [
  ["01", "设定世界", "角色、剧本、参考与视觉规则"],
  ["02", "连接镜头", "画布、分镜与生成任务"],
  ["03", "沉淀资产", "可复用的图像、视频和提示词"],
  ["04", "持续制作", "团队协作、用量与预算控制"],
];

function Arrow() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
}

function Spark() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 2 1.85 6.15L20 10l-6.15 1.85L12 18l-1.85-6.15L4 10l6.15-1.85Z" /><path d="m19 16 .72 2.28L22 19l-2.28.72L19 22l-.72-2.28L16 19l2.28-.72L19 16Z" /></svg>;
}

function HeroMedia({ className = "", animated = false }: { className?: string; animated?: boolean }) {
  const [videoFailed, setVideoFailed] = useState(false);
  if (animated && HERO_VIDEO_SRC && !videoFailed) {
    return <video className={className} autoPlay muted loop playsInline disablePictureInPicture poster="/fg-cat-director.png" preload="metadata" onError={() => setVideoFailed(true)}><source src={HERO_VIDEO_SRC} type="video/mp4" /></video>;
  }
  return <img src="/fg-cat-director.png" alt="FG Studio 的 3D 猫导演角色" className={className} />;
}

export default function Landing() {
  const router = useRouter();
  const supabase = createClient();
  const heroRef = useRef<HTMLElement>(null);
  const [authed, setAuthed] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [introProgress, setIntroProgress] = useState(0);
  const [heroProgress, setHeroProgress] = useState(0);

  useEffect(() => { supabase.auth.getSession().then(({ data }) => setAuthed(Boolean(data.session))); }, [supabase]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const viewport = window.innerHeight || 1;
      const scrollTop = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      const intro = Math.max(0, Math.min(1, scrollTop / (viewport * 0.76)));
      const top = heroRef.current?.getBoundingClientRect().top ?? viewport;
      const hero = Math.max(0, Math.min(1, (viewport * 0.94 - top) / (viewport * 0.72)));
      setIntroProgress(intro);
      setHeroProgress(hero);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    return () => { if (frame) cancelAnimationFrame(frame); window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onScroll); };
  }, []);

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
    } catch (error: any) {
      setMessage(error?.message || "暂时无法完成操作，请稍后再试。");
    } finally { setBusy(false); }
  }

  const introStyle = { opacity: 1 - introProgress * 0.9, transform: `translate3d(0, ${introProgress * 52}px, 0) scale(${1 - introProgress * 0.055})` };
  const heroStyle = { opacity: Math.min(1, heroProgress * 1.45 + 0.12), transform: `translate3d(0, ${(1 - heroProgress) * 44}px, 0)` };

  return (
    <main className="fg-home fg-home--magenta min-h-screen overflow-x-clip text-white">
      <section className="relative h-[158svh] overflow-clip bg-[#e40057]">
        <div className="sticky top-0 flex h-[100svh] min-h-[680px] flex-col overflow-hidden px-5 pb-7 pt-5 sm:px-9 sm:pb-9 sm:pt-7 lg:px-12">
          <HeroMedia animated className="absolute inset-0 h-full w-full object-cover object-[63%_center]" />
          <div className="fg-home-intro-veil pointer-events-none absolute inset-0" />
          <div className="fg-home-grid pointer-events-none absolute inset-0" />
          <div className="fg-home-orbit fg-home-orbit--one pointer-events-none" />
          <div className="fg-home-orbit fg-home-orbit--two pointer-events-none" />
          <div className="fg-home-bloom fg-home-bloom--intro-a pointer-events-none" />
          <div className="fg-home-bloom fg-home-bloom--intro-b pointer-events-none" />

          <nav className="relative z-30 flex items-center justify-between gap-4">
            <Link href="/" className="inline-flex items-center gap-2.5 text-[13px] font-medium tracking-tight" aria-label="FG Studio 首页">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-white p-1.5 shadow-[0_6px_22px_rgba(52,0,25,.18)]"><FGLogo size={26} /></span>
              <span className="hidden leading-tight sm:block">FG STUDIO<br /><span className="font-mono text-[8px] tracking-[.18em] text-white/65">FILM AT SCALE</span></span>
            </Link>
            <div className="hidden items-center gap-6 text-[11px] font-medium text-white/80 md:flex"><a href="#tools" className="transition hover:text-white">工作入口</a><a href="#method" className="transition hover:text-white">创作方式</a><Link href="/presets" className="transition hover:text-white">预设与提示词</Link></div>
            <div className="flex items-center gap-2"><span className="fg-home-theme"><ThemeToggle /></span><button onClick={enterWorkspace} className="fg-home-enter group inline-flex items-center gap-2 rounded-full py-2 pl-4 pr-2 text-[12px] font-semibold transition hover:scale-[1.025] active:scale-[.98]">{authed ? "进入工作区" : "登录"}<span className="grid h-6 w-6 place-items-center rounded-full bg-[#e40057] text-white transition group-hover:translate-x-0.5"><Arrow /></span></button></div>
          </nav>

          <div className="relative z-10 mx-auto flex w-full max-w-[1320px] flex-1 items-center">
            <div className="relative w-full max-w-[920px] pb-6 sm:pb-0" style={introStyle}>
              <p className="mb-3 font-mono text-[10px] uppercase tracking-[.21em] text-white/75 sm:mb-5">FableGlitch / AI film production workspace</p>
              <div className="h-[clamp(90px,15.8vw,205px)] max-w-[890px]"><ParticleText text="WORLDS" particleSize={2.15} density={4.15} color="#ffffff" highlightColor="#7effd4" scatter={185} gatherDuration={1500} stagger={430} pointerRepel={46} repelRadius={145} fontSize="clamp(4.1rem, 13.7vw, 11.7rem)" fontWeight={900} fontFamily="var(--font-display)" /></div>
              <div className="ml-[clamp(4px,5vw,76px)] mt-[-.08em] max-w-[840px]"><EchoText text="MOVIE." echoes={10} lag={0.2} offset={27} direction="diagonal" fade={0.72} blur={2.2} tint="#ff92bd" fontSize="clamp(4.1rem, 14.4vw, 12.1rem)" fontWeight={900} color="#ffffff" /></div>
              <div className="mt-[-.12em]"><DepthText text="IN MOTION." layers={20} depth={2.5} faceColor="#ffffff" depthColor="#970037" tilt={4} autoOrbit orbitSpeed={0.22} fontSize="clamp(1.6rem, 4.6vw, 4rem)" fontWeight={850} /></div>
              <div className="mt-7 flex max-w-[610px] flex-wrap items-center gap-x-5 gap-y-3 text-[12px] leading-relaxed text-white/85 sm:mt-8 sm:text-[14px]"><p className="max-w-[46ch]">从故事、角色到最终镜头，把灵感、制作和可复用的资产放进同一个会持续生长的工作流。</p><span className="hidden h-7 w-px bg-white/30 sm:block" /><span className="font-mono text-[10px] uppercase tracking-[.16em] text-white/70">scroll to enter ↓</span></div>
            </div>
          </div>
          <div className="relative z-10 flex items-end justify-between gap-5 border-t border-white/25 pt-4 text-[10px] font-mono uppercase tracking-[.14em] text-white/75"><span>01 — Worlds, in motion.</span><span className="hidden sm:block">FABLEGLITCH / FG STUDIO / 2026</span></div>
        </div>
      </section>

      <section ref={heroRef} className="relative min-h-[136svh] bg-[#e40057]" aria-label="FG Studio 创作入口">
        <div className="sticky top-0 h-[100svh] min-h-[700px] overflow-hidden">
          <HeroMedia className="absolute inset-0 h-full w-full object-cover object-[64%_center]" />
          <div className="fg-home-hero-veil absolute inset-0" />
          <div className="fg-home-liquid-ether pointer-events-none absolute inset-0"><LiquidEther colors={["#ff9dcb", "#6ee9ff", "#8d43ff"]} resolution={0.34} autoSpeed={0.42} autoIntensity={0.7} /></div>
          <div className="fg-home-grid pointer-events-none absolute inset-0 opacity-50" />
          <div className="fg-home-bloom fg-home-bloom--hero pointer-events-none" />
          <div className="relative z-10 flex h-full flex-col px-5 pb-7 pt-5 sm:px-9 sm:pb-9 sm:pt-7 lg:px-12">
            <div className="flex justify-end"><a href="#tools" className="rounded-full border border-white/35 bg-[#b30045]/40 px-4 py-2 font-mono text-[10px] uppercase tracking-[.16em] text-white backdrop-blur-md transition hover:bg-white/15">进入创作地图 <span aria-hidden="true">→</span></a></div>
            <div className="flex flex-1 items-center" style={heroStyle}><div className="max-w-[640px]"><p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/35 bg-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.16em] text-white/90 backdrop-blur-md"><span className="h-1.5 w-1.5 rounded-full bg-[#7effd4] shadow-[0_0_12px_#7effd4]" /> the director points to what matters</p><h1 className="font-disp text-[clamp(48px,8vw,126px)] font-semibold leading-[.78] tracking-[-.075em]">把创作，<br /><span className="text-white/50">做成一条线。</span></h1><p className="mt-7 max-w-[43ch] text-[14px] leading-relaxed text-white/88 sm:text-[16px]">别再让剧本、参考图、镜头、提示词和生成结果散落在不同窗口。让猫导演把注意力指回一条能延续的制作线。</p><div className="mt-8 flex flex-wrap gap-3"><SpecularButton onClick={enterWorkspace} size="sm" radius={999} tint="#160014" tintOpacity={0.9} lineColor="#ffffff" baseColor="#ff83b4" textColor="#ffffff" intensity={1.2} autoAnimate className="!px-5 !py-3 !text-[13px]"><span className="inline-flex items-center gap-3">开始一个项目 <Arrow /></span></SpecularButton><Link href="/creator#/canvas" className="inline-flex items-center gap-2 rounded-full border border-white/45 bg-white/[.08] px-5 py-3 text-[13px] font-medium text-white backdrop-blur transition hover:bg-white/15"><Spark /> 打开无限画布</Link></div></div></div>
            <div className="flex items-end justify-between border-t border-white/25 pt-4 text-[10px] font-mono uppercase tracking-[.14em] text-white/75"><span>02 — Connect, direct, render.</span><span className="hidden sm:block">A SMALL DIRECTOR FOR A BIG WORKFLOW</span></div>
          </div>
        </div>
      </section>

      <section id="tools" className="relative overflow-hidden bg-[#c9004d] px-5 py-20 sm:px-9 sm:py-28 lg:px-12">
        <div className="fg-home-grid pointer-events-none absolute inset-0 opacity-55" />
        <div className="fg-home-bloom fg-home-bloom--tools-a pointer-events-none" /><div className="fg-home-bloom fg-home-bloom--tools-b pointer-events-none" />
        <div className="relative mx-auto grid max-w-[1320px] gap-12 lg:grid-cols-[minmax(0,.88fr)_minmax(500px,1.12fr)] lg:items-center">
          <div><p className="font-mono text-[11px] uppercase tracking-[.18em] text-[#ffd4e2]">One workspace with a memory.</p><h2 className="mt-5 max-w-[11ch] font-disp text-[clamp(50px,7vw,100px)] font-semibold leading-[.84] tracking-[-.075em]">每一个好结果，都值得留下。</h2><p className="mt-8 max-w-[42ch] text-[15px] leading-relaxed text-white/85">同一个角色、同一组镜头、同一条故事线，可以从第一次草稿走到下一次更快、更稳定的制作。角色不是装饰，它负责把你的注意力指向下一步。</p><div className="mt-9 grid max-w-[590px] gap-2.5">{WORKSPACES.map(([no, title, desc, href]) => <Link key={no} href={href} className="group flex items-center gap-4 rounded-2xl border border-white/25 bg-[#930038]/45 px-4 py-4 backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-[#76002f]/75"><span className="font-mono text-[10px] text-[#7effd4]">{no}</span><span className="min-w-0 flex-1"><b className="block text-[15px]">{title}</b><small className="mt-0.5 block text-[12px] text-white/70">{desc}</small></span><span className="text-[#7effd4] transition group-hover:translate-x-1"><Arrow /></span></Link>)}</div></div>
          <div className="relative min-h-[500px] overflow-hidden rounded-[34px] border border-white/30 bg-[#890035]/40 shadow-[0_30px_90px_rgba(87,0,36,.45)]"><div className="fg-home-card-glow absolute inset-0" /><img src="/fg-cat-director.png" alt="3D 猫导演展示制作面板" className="absolute inset-0 h-full w-full object-cover object-[65%_center]" /><div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(102,0,40,.58),transparent_54%,rgba(61,0,37,.18))]" /><div className="absolute bottom-5 left-5 right-5 flex items-end justify-between gap-4 rounded-2xl border border-white/25 bg-[#650029]/45 p-4 backdrop-blur-md"><div><span className="font-mono text-[9px] uppercase tracking-[.16em] text-[#7effd4]">FG CAT / ON SET</span><p className="mt-1 text-[14px] font-medium">从角色设定到最终成片，始终留在场。</p></div><span className="grid h-9 w-9 flex-none place-items-center rounded-full border border-white/30 bg-white/10 text-white"><Arrow /></span></div></div>
        </div>
      </section>

      <section id="method" className="relative overflow-hidden bg-[#100016] px-5 py-20 sm:px-9 sm:py-28 lg:px-12">
        <div className="fg-home-method-glow fg-home-method-glow--a pointer-events-none" /><div className="fg-home-method-glow fg-home-method-glow--b pointer-events-none" /><div className="fg-home-grid pointer-events-none absolute inset-0 opacity-35" />
        <div className="relative mx-auto grid max-w-[1320px] gap-14 lg:grid-cols-[.84fr_1.16fr] lg:items-start"><div><p className="font-mono text-[11px] uppercase tracking-[.17em] text-[#65e9ff]">A production system with a memory.</p><h2 className="mt-5 font-disp text-[clamp(44px,6.2vw,94px)] font-semibold leading-[.84] tracking-[-.075em]">导演工作台，<br /><span className="text-white/48">也是资产库。</span></h2><p className="mt-8 max-w-[43ch] text-[15px] leading-relaxed text-white/75">无论独立制作还是团队协作，结果都能回到项目、镜头和资产库里；同时保留模型用量、预算和每个阶段的上下文。</p><button onClick={enterWorkspace} className="mt-9 inline-flex items-center gap-3 rounded-full bg-[#65e9ff] px-5 py-3 text-[13px] font-semibold text-[#07151b] transition hover:brightness-110 active:scale-[.98]">进入你的工作区 <Arrow /></button></div><div className="divide-y divide-white/15 border-y border-white/15">{PIPELINE.map(([no, title, desc]) => <div key={no} className="group grid grid-cols-[auto_1fr_auto] items-center gap-4 py-5 sm:grid-cols-[64px_200px_1fr_auto]"><span className="font-mono text-[11px] text-[#65e9ff]">{no}</span><b className="font-disp text-[18px] font-medium tracking-tight">{title}</b><span className="hidden text-[13px] text-white/60 sm:block">{desc}</span><span className="text-white/45 transition group-hover:translate-x-1 group-hover:text-[#65e9ff]"><Arrow /></span></div>)}</div></div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 bg-[#100016] px-5 py-8 text-[11px] text-white/55 sm:px-9 lg:px-12"><span className="inline-flex items-center gap-2 font-medium text-white"><FGLogo size={22} /> FG STUDIO</span><span>FableGlitch AI production workspace</span><Link href="/login" className="transition hover:text-[#7effd4]">登录工作区 <span aria-hidden="true">→</span></Link></footer>

      {showAuth && <div className="fixed inset-0 z-[100] grid place-items-center bg-[#08080c]/75 p-5 backdrop-blur-md" onClick={() => !busy && setShowAuth(false)}><div className="w-[420px] max-w-full rounded-[25px] border border-white/15 bg-[#17171f]/95 p-7 text-white shadow-[0_30px_80px_rgba(0,0,0,.55)]" onClick={(event) => event.stopPropagation()}><div className="mb-5 flex items-start justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-[.18em] text-[#65e9ff]">FG STUDIO / ACCESS</div><h3 className="mt-2 font-disp text-[25px] font-semibold tracking-tight">{mode === "signin" ? "登录工作区" : "注册账号"}</h3></div><button onClick={() => !busy && setShowAuth(false)} className="grid h-8 w-8 place-items-center rounded-full border border-white/15 text-white/65 transition hover:bg-white/10 hover:text-white" aria-label="关闭">×</button></div>{mode === "signup" ? <div className="mb-3 flex overflow-hidden rounded-xl border border-white/15 bg-white/[.05] focus-within:border-[#65e9ff]"><input className="min-w-0 flex-1 bg-transparent px-3.5 py-3 text-[15px] text-white outline-none placeholder:text-white/35" value={username} placeholder="例如：meilinte" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => setUsername(normalizeCompanyUsername(event.target.value))} /><span className="flex items-center border-l border-white/10 px-3 text-[13px] text-[#65e9ff]">@beva.com</span></div> : <input className="mb-3 w-full rounded-xl border border-white/15 bg-white/[.05] px-3.5 py-3 text-[15px] text-white outline-none placeholder:text-white/35 focus:border-[#65e9ff]" value={email} placeholder="yourname@beva.com" autoCapitalize="none" onChange={(event) => setEmail(event.target.value)} />}<input className="w-full rounded-xl border border-white/15 bg-white/[.05] px-3.5 py-3 text-[15px] text-white outline-none placeholder:text-white/35 focus:border-[#65e9ff]" type="password" value={password} placeholder="密码（至少 6 位）" onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submit()} />{message && <p className="mt-3 text-[13px] leading-relaxed text-[#ffb0c4]">{message}</p>}<button disabled={busy} onClick={submit} className="mt-4 w-full rounded-full bg-[#65e9ff] py-3 text-[14px] font-semibold text-[#08161d] transition hover:brightness-110 disabled:opacity-55">{busy ? "处理中…" : mode === "signin" ? "登录" : "注册并登录"}</button><p className="mt-5 text-center text-[13px] text-white/55">{mode === "signin" ? "还没有账号？" : "已有账号？"} <button className="font-medium text-[#65e9ff] hover:underline" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); }}>{mode === "signin" ? "去注册" : "去登录"}</button></p><p className="mt-5 border-t border-white/10 pt-4 text-[11px] leading-relaxed text-white/45">注册仅允许公司 <b className="text-[#65e9ff]">@beva.com</b> 邮箱。</p></div></div>}
    </main>
  );
}
