"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import FGLogo from "@/components/FGLogo";
import ThemeToggle from "@/components/ThemeToggle";
import { companyEmailFromUsername, normalizeCompanyUsername } from "@/lib/auth/company-email";
import { createClient } from "@/lib/supabase/client";

const EchoText: any = dynamic(() => import("@/components/react-bits/EchoText"), { ssr: false });
const DepthText: any = dynamic(() => import("@/components/react-bits/DepthText"), { ssr: false });
const SpecularButton: any = dynamic(() => import("@/components/react-bits/SpecularButton"), { ssr: false });
const ScrollExpand: any = dynamic(() => import("@/components/react-bits/ScrollExpand"), { ssr: false });

const HERO_VIDEO_SRC = process.env.NEXT_PUBLIC_FG_HERO_VIDEO_SRC?.trim() || "/landing-media/fg-hero-4k.mp4";
const STUDIO_VIDEO_SRC = process.env.NEXT_PUBLIC_FG_STUDIO_VIDEO_SRC?.trim() || "/landing-media/fg-studio-4k.mp4";
const ARCHIVE_VIDEO_SRC = process.env.NEXT_PUBLIC_FG_ARCHIVE_VIDEO_SRC?.trim() || "/landing-media/fg-archive-4k.mp4";

const WORKSPACES = [
  { no: "01", title: "无限画布", desc: "把参考、文字、图片和视频接成一条可继续生长的线。", href: "/creator#/canvas" },
  { no: "02", title: "导演项目", desc: "从剧本、人物到逐镜设计，让叙事和镜头留在同一个项目里。", href: "/workspace" },
  { no: "03", title: "模型工作台", desc: "对话、生图、生视频与预算记录，都在一处完成。", href: "/creator" },
];

const ARCHIVE_STEPS = [
  ["01", "保存创作上下文", "角色、提示词、分镜和参考图不再散落在聊天记录里。"],
  ["02", "连接生成结果", "把图片、视频与它们的来处放回同一张制作地图。"],
  ["03", "协作与预算可见", "团队成员、模型用量和每月额度在项目进度中同步查看。"],
];

const PLATFORM_CAPABILITIES = [
  ["01", "从剧本到镜头", "在导演项目里沉淀人物、场景、剧情结构与逐镜头设计，让创意决定能被团队接着用。"],
  ["02", "无限画布创作", "把参考图、文本、图片、视频和生成关系连在同一张画布上，清楚看见每个结果从哪里来。"],
  ["03", "多模型制作台", "在同一入口完成对话、图像和视频生成；模型、规格、参考素材与预估价格始终可见。"],
  ["04", "技能与提示词", "把稳定好用的导演方法、视觉风格和提示词模板变成可选择的工作技能，而不是散落的聊天记录。"],
  ["05", "资产持续可用", "生成内容可以保存到项目与资产库，下一次延续角色、镜头和风格时不必从零开始。"],
  ["06", "团队预算有数", "按用户、项目和模型查看使用量与花费，并以月度额度为边界，让协作不失控。"],
];

function Arrow() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
}

function Spark() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 2 1.85 6.15L20 10l-6.15 1.85L12 18l-1.85-6.15L4 10l6.15-1.85Z" /><path d="m19 16 .72 2.28L22 19l-2.28.72L19 22l-.72-2.28L16 19l2.28-.72L19 16Z" /></svg>;
}

function HeroMedia({ className = "" }: { className?: string }) {
  const [videoFailed, setVideoFailed] = useState(false);
  if (HERO_VIDEO_SRC && !videoFailed) {
    return <video className={className} autoPlay muted loop playsInline disablePictureInPicture poster="/landing-media/fg-hero-poster.jpg" preload="metadata" onError={() => setVideoFailed(true)}><source src={HERO_VIDEO_SRC} type="video/mp4" /></video>;
  }
  return <img src="/landing-media/fg-hero-poster.jpg" alt="FG Studio 的 3D 猫导演角色" className={className} />;
}

function LoopBackdrop({ videoSrc, fallbackSrc, alt, className = "" }: { videoSrc: string; fallbackSrc: string; alt: string; className?: string }) {
  const [videoFailed, setVideoFailed] = useState(false);
  if (videoSrc && !videoFailed) {
    return <video className={className} autoPlay muted loop playsInline disablePictureInPicture poster={fallbackSrc} preload="metadata" onError={() => setVideoFailed(true)}><source src={videoSrc} type="video/mp4" /></video>;
  }
  return <img src={fallbackSrc} alt={alt} className={className} />;
}

export default function Landing() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [authed, setAuthed] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [introProgress, setIntroProgress] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(Boolean(data.session)));
  }, [supabase]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const viewport = window.innerHeight || 1;
      const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
      setIntroProgress(Math.max(0, Math.min(1, scrollTop / (viewport * 0.76))));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
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
    } finally {
      setBusy(false);
    }
  }

  const introStyle = { opacity: 1 - introProgress * 0.9, transform: `translate3d(0, ${introProgress * 52}px, 0) scale(${1 - introProgress * 0.055})` };

  return (
    <main className="fg-home fg-home--magenta min-h-screen overflow-x-clip text-white">
      <section className="relative h-[158svh] overflow-clip bg-[#e40057]">
        <div className="sticky top-0 flex h-[100svh] min-h-[680px] flex-col overflow-hidden px-5 pb-7 pt-5 sm:px-9 sm:pb-9 sm:pt-7 lg:px-12">
          <HeroMedia className="fg-home-intro-video absolute inset-0 h-full w-full object-cover object-[63%_center]" />
          <div className="fg-home-intro-veil pointer-events-none absolute inset-0" />

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
              <div className="fg-home-hero-worlds max-w-[890px]">WORLDS</div>
              <div className="ml-[clamp(4px,5vw,76px)] mt-[-.08em] max-w-[840px]"><EchoText text="MOVIE." echoes={10} lag={0.2} offset={27} direction="diagonal" fade={0.72} blur={2.2} tint="#ff92bd" fontSize="clamp(4.1rem, 14.4vw, 12.1rem)" fontWeight={900} color="#ffffff" /></div>
              <div className="mt-[-.12em]"><DepthText text="IN MOTION." layers={20} depth={2.5} faceColor="#ffffff" depthColor="#970037" tilt={4} autoOrbit orbitSpeed={0.22} fontSize="clamp(1.6rem, 4.6vw, 4rem)" fontWeight={850} /></div>
              <div className="mt-7 flex max-w-[610px] flex-wrap items-center gap-x-5 gap-y-3 text-[12px] leading-relaxed text-white/85 sm:mt-8 sm:text-[14px]"><p className="max-w-[46ch]">从故事、角色到最终镜头，把灵感、制作和可复用的资产放进同一个会持续生长的工作流。</p><span className="hidden h-7 w-px bg-white/30 sm:block" /><span className="font-mono text-[10px] uppercase tracking-[.16em] text-white/70">scroll to enter ↓</span></div>
            </div>
          </div>
          <div className="relative z-10 flex items-end justify-between gap-5 border-t border-white/25 pt-4 text-[10px] font-mono uppercase tracking-[.14em] text-white/75"><span>01 — Worlds, in motion.</span><span className="hidden sm:block">FABLEGLITCH / FG STUDIO / 2026</span></div>
        </div>
      </section>

      <section id="tools" className="relative bg-[#e20057]" aria-label="FG Studio 创作入口">
        <ScrollExpand
          src={STUDIO_VIDEO_SRC}
          fallbackSrc="/landing-media/fg-studio-poster.jpg"
          poster="/landing-media/fg-studio-poster.jpg"
          alt="猫导演在红色创作现场指向三个工作入口"
          mediaType="video"
          title="把创作，接成一条线。"
          scrollHint="scroll to open the studio"
          startWidth={84}
          startHeight={72}
          startRadius={32}
          mediaZoom={1.1}
          scrollDistance={1.02}
          holdDistance={0.42}
          smoothing={0.09}
          overlayScrim={0.52}
          useWindowScroll
          className="fg-home-studio-expand"
        >
          <div className="fg-home-studio-content-shell">
            <div className="flex justify-end"><a href="#method" className="fg-home-outline-link">进入创作档案 <span aria-hidden="true">↓</span></a></div>
            <div className="mx-auto flex w-full max-w-[1320px] flex-1 items-center">
              <div className="fg-home-studio-copy max-w-[640px]">
                <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/35 bg-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.16em] text-white/95 backdrop-blur-md"><span className="h-1.5 w-1.5 rounded-full bg-[#7effd4] shadow-[0_0_12px_#7effd4]" /> the director points to what matters</p>
                <h1 className="font-disp text-[clamp(48px,8vw,126px)] font-semibold leading-[.78] tracking-[-.075em]">把创作，<br /><span>接成一条线。</span></h1>
                <p className="mt-7 max-w-[43ch] text-[14px] font-medium leading-relaxed text-white sm:text-[16px]">不必再让剧本、参考图、镜头、提示词和生成结果散落在不同窗口。选择一个入口开始，所有成果都会沿着同一条制作线留下来。</p>
                <div className="mt-8 grid gap-2.5">{WORKSPACES.map(({ no, title, desc, href }) => <Link key={no} href={href} className="fg-home-workspace-card group"><span className="fg-home-workspace-number">{no}</span><span className="min-w-0 flex-1"><b>{title}</b><small>{desc}</small></span><span className="fg-home-workspace-arrow"><Arrow /></span></Link>)}</div>
              </div>
            </div>
            <div className="flex items-end justify-between border-t border-white/25 pt-4 text-[10px] font-mono uppercase tracking-[.14em] text-white/85"><span>02 — Connect, direct, render.</span><span className="hidden sm:block">A SMALL DIRECTOR FOR A BIG WORKFLOW</span></div>
          </div>
        </ScrollExpand>
      </section>

      <section id="method" className="relative overflow-hidden bg-[#08090d] px-5 py-24 sm:px-9 sm:py-32 lg:px-12">
        <LoopBackdrop videoSrc={ARCHIVE_VIDEO_SRC} fallbackSrc="/landing-media/fg-archive-poster.jpg" alt="猫导演在暗色剪辑室整理分镜和创作资产" className="fg-home-archive-image pointer-events-none absolute inset-0 h-full w-full object-cover object-[69%_center]" />
        <div className="fg-home-archive-veil pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-[1320px] gap-16 lg:grid-cols-[minmax(0,.9fr)_minmax(430px,1.1fr)] lg:items-center">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[.18em] text-[#72eaff]">A production system with a memory.</p>
            <h2 className="fg-home-archive-heading mt-5">留住每一次<br />生效的创作决定。</h2>
            <p className="mt-7 max-w-[43ch] text-[15px] font-medium leading-relaxed text-white/85 sm:text-[16px]">FG Studio 把可复用的创作过程当作资产：角色、场景、分镜、模型选择、提示词和生成结果都能回到项目里。下一次制作，不需要从空白聊天框重新开始。</p>
            <div className="mt-9 flex flex-wrap gap-3"><SpecularButton onClick={enterWorkspace} size="sm" radius={999} tint="#0a3540" tintOpacity={0.98} lineColor="#8ff5ff" baseColor="#65e9ff" textColor="#efffff" intensity={1.15} autoAnimate className="!px-5 !py-3 !text-[13px]"><span className="inline-flex items-center gap-3">进入你的工作区 <Arrow /></span></SpecularButton><Link href="/creator#/canvas" className="fg-home-dark-secondary"><Spark /> 从一张画布开始</Link></div>
          </div>
          <div className="fg-home-archive-list">{ARCHIVE_STEPS.map(([no, title, desc]) => <div key={no} className="fg-home-archive-step group"><span>{no}</span><div><b>{title}</b><p>{desc}</p></div><i><Arrow /></i></div>)}</div>
        </div>
      </section>

      <section className="fg-home-capabilities bg-[#090b12] px-5 py-24 sm:px-9 sm:py-32 lg:px-12" aria-label="FG Studio 平台能力">
        <div className="mx-auto max-w-[1320px]">
          <div className="grid gap-8 border-b border-white/15 pb-12 lg:grid-cols-[minmax(0,.72fr)_minmax(0,1.28fr)] lg:items-end">
            <div><p className="font-mono text-[11px] uppercase tracking-[.18em] text-[#7effd4]">One production line. Many ways to make.</p><h2 className="mt-5 max-w-[10ch] font-disp text-[clamp(40px,5.3vw,80px)] font-semibold leading-[.88] tracking-[-.065em] text-white">从灵感，到能继续制作的世界。</h2></div>
            <p className="max-w-[51ch] text-[15px] leading-relaxed text-white/72 sm:text-[17px]">它既是面向个人的创作入口，也是团队共用的制作系统。你可以只从一张图或一句话开始，也可以把完整的剧本、分镜、资产和预算放进同一条工作流。</p>
          </div>
          <div className="fg-home-capability-list">{PLATFORM_CAPABILITIES.map(([no, title, desc]) => <article key={no} className="fg-home-capability-row"><span>{no}</span><h3>{title}</h3><p>{desc}</p><i><Arrow /></i></article>)}</div>
          <div className="mt-14 border-t border-white/15 pt-7"><p className="font-mono text-[10px] uppercase tracking-[.16em] text-white/52">write · direct · connect · generate · remember · collaborate</p><div className="mt-5 flex flex-wrap gap-3"><Link href="/presets" className="fg-home-dark-secondary">查看预设与提示词 <Arrow /></Link><button onClick={enterWorkspace} className="fg-home-capability-cta">开始一个项目 <Arrow /></button></div></div>
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 bg-[#08090d] px-5 py-8 text-[11px] text-white/55 sm:px-9 lg:px-12"><span className="inline-flex items-center gap-2 font-medium text-white"><FGLogo size={22} /> FG STUDIO</span><span>FableGlitch AI production workspace</span><Link href="/login" className="transition hover:text-[#7effd4]">登录工作区 <span aria-hidden="true">→</span></Link></footer>

      {showAuth && <div className="fixed inset-0 z-[100] grid place-items-center bg-[#08080c]/75 p-5 backdrop-blur-md" onClick={() => !busy && setShowAuth(false)}><div className="w-[420px] max-w-full rounded-[25px] border border-white/15 bg-[#17171f]/95 p-7 text-white shadow-[0_30px_80px_rgba(0,0,0,.55)]" onClick={(event) => event.stopPropagation()}><div className="mb-5 flex items-start justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-[.18em] text-[#65e9ff]">FG STUDIO / ACCESS</div><h3 className="mt-2 font-disp text-[25px] font-semibold tracking-tight">{mode === "signin" ? "登录工作区" : "注册账号"}</h3></div><button onClick={() => !busy && setShowAuth(false)} className="grid h-8 w-8 place-items-center rounded-full border border-white/15 text-white/65 transition hover:bg-white/10 hover:text-white" aria-label="关闭">×</button></div>{mode === "signup" ? <div className="mb-3 flex overflow-hidden rounded-xl border border-white/15 bg-white/[.05] focus-within:border-[#65e9ff]"><input className="min-w-0 flex-1 bg-transparent px-3.5 py-3 text-[15px] text-white outline-none placeholder:text-white/35" value={username} placeholder="例如：meilinte" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => setUsername(normalizeCompanyUsername(event.target.value))} /><span className="flex items-center border-l border-white/10 px-3 text-[13px] text-[#65e9ff]">@beva.com</span></div> : <input className="mb-3 w-full rounded-xl border border-white/15 bg-white/[.05] px-3.5 py-3 text-[15px] text-white outline-none placeholder:text-white/35 focus:border-[#65e9ff]" value={email} placeholder="yourname@beva.com" autoCapitalize="none" onChange={(event) => setEmail(event.target.value)} />}<input className="w-full rounded-xl border border-white/15 bg-white/[.05] px-3.5 py-3 text-[15px] text-white outline-none placeholder:text-white/35 focus:border-[#65e9ff]" type="password" value={password} placeholder="密码（至少 6 位）" onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submit()} />{message && <p className="mt-3 text-[13px] leading-relaxed text-[#ffb0c4]">{message}</p>}<button disabled={busy} onClick={submit} className="mt-4 w-full rounded-full bg-[#65e9ff] py-3 text-[14px] font-semibold text-[#08161d] transition hover:brightness-110 disabled:opacity-55">{busy ? "处理中…" : mode === "signin" ? "登录" : "注册并登录"}</button><p className="mt-5 text-center text-[13px] text-white/55">{mode === "signin" ? "还没有账号？" : "已有账号？"} <button className="font-medium text-[#65e9ff] hover:underline" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); }}>{mode === "signin" ? "去注册" : "去登录"}</button></p><p className="mt-5 border-t border-white/10 pt-4 text-[11px] leading-relaxed text-white/45">注册仅允许公司 <b className="text-[#65e9ff]">@beva.com</b> 邮箱。</p></div></div>}
    </main>
  );
}
