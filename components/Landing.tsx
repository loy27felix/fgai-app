"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import FGLogo from "@/components/FGLogo";
import { createClient } from "@/lib/supabase/client";
import { companyEmailFromUsername, normalizeCompanyUsername } from "@/lib/auth/company-email";

// The supplied React Bits snippets are intentionally untyped JSX. Keep their
// public API isolated at this composition boundary instead of weakening app-wide TS.
const ParticleText: any = dynamic(() => import("@/components/react-bits/ParticleText"), { ssr: false });
const EchoText: any = dynamic(() => import("@/components/react-bits/EchoText"), { ssr: false });
const DepthText: any = dynamic(() => import("@/components/react-bits/DepthText"), { ssr: false });
const ElasticMesh: any = dynamic(() => import("@/components/react-bits/ElasticMesh"), { ssr: false });
const RippleDistortion: any = dynamic(() => import("@/components/react-bits/RippleDistortion"), { ssr: false });
const DepthCarousel: any = dynamic(() => import("@/components/react-bits/DepthCarousel"), { ssr: false });
const MaskedHeading: any = dynamic(() => import("@/components/react-bits/MaskedHeading"), { ssr: false });
const SpecularButton: any = dynamic(() => import("@/components/react-bits/SpecularButton"), { ssr: false });

const STAGES = [
  ["01", "故事与剧本", "从灵感、剧本到角色圣经"],
  ["02", "无限画布", "把图片、镜头与视频连成一条线"],
  ["03", "导演分镜", "让画面、动作与节奏可以协作"],
  ["04", "生成与资产", "调模型、看用量、沉淀可复用资产"],
];

const CAROUSEL_ITEMS = [
  { image: "/fg-hero-magenta.png", alt: "FG Studio 角色与制作界面" },
  { image: "/fg-hero-magenta.png", alt: "FG Studio 洋红创作场景" },
  { image: "/fg-hero-magenta.png", alt: "FG Studio 洋红创作场景" },
  { image: "/fg-hero-magenta.png", alt: "FG Studio 创作伙伴" },
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
      const nextIntro = Math.max(0, Math.min(1, scrollTop / (viewport * 0.82)));
      const top = heroRef.current?.getBoundingClientRect().top ?? viewport;
      const nextHero = Math.max(0, Math.min(1, (viewport * 0.92 - top) / (viewport * 0.78)));
      setIntroProgress(nextIntro);
      setHeroProgress(nextHero);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    // The app shell reserves the browser viewport, so Safari/Chrome may make
    // body rather than window the scrolling element. Capture handles both.
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll, true);
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
    } catch (error: any) { setMessage(error?.message || "暂时无法完成操作，请稍后再试。"); }
    finally { setBusy(false); }
  }

  const introStyle = { opacity: 1 - introProgress * 0.88, transform: `translate3d(0, ${introProgress * 56}px, 0) scale(${1 - introProgress * 0.075})` };
  const heroStyle = { opacity: Math.min(1, heroProgress * 1.7 + 0.06), transform: `translate3d(0, ${(1 - heroProgress) * 54}px, 0)` };

  return (
    <main className="fg-home min-h-screen overflow-x-clip bg-[#e50059] text-white">
      <section className="relative h-[168svh] overflow-clip bg-[#e50059]">
        <div className="sticky top-0 flex h-[100svh] min-h-[680px] flex-col overflow-hidden px-5 pb-7 pt-5 sm:px-9 sm:pb-9 sm:pt-7 lg:px-12">
          <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(rgba(255,255,255,.29)_1px,transparent_1px)] [background-size:18px_18px]" />
          <div className="pointer-events-none absolute -left-[16%] top-[5%] h-[85%] w-[82%] rotate-[-17deg] rounded-full border-[46px] border-white/[.11]" />
          <div className="pointer-events-none absolute -right-[15%] -top-[28%] h-[94%] w-[64%] rounded-full bg-[#ff8ab9]/30 blur-3xl" />
          <nav className="relative z-20 flex items-center justify-between gap-4">
            <Link href="/" className="inline-flex items-center gap-2.5 text-[13px] font-medium tracking-tight" aria-label="FG Studio 首页"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white p-1.5 shadow-[0_6px_22px_rgba(52,0,25,.18)]"><FGLogo size={26} /></span><span className="hidden leading-tight sm:block">FG STUDIO<br /><span className="font-mono text-[8px] tracking-[.18em] text-white/65">FILM AT SCALE</span></span></Link>
            <div className="hidden items-center gap-6 text-[11px] font-medium text-white/75 md:flex"><a href="#tools" className="transition hover:text-white">工作入口</a><a href="#method" className="transition hover:text-white">创作方式</a><Link href="/presets" className="transition hover:text-white">预设与提示词</Link></div>
            <div className="flex items-center gap-2"><ThemeToggle /><button onClick={enterWorkspace} className="group inline-flex items-center gap-2 rounded-full bg-white py-2 pl-4 pr-2 text-[12px] font-semibold text-[#17131b] transition hover:scale-[1.025] active:scale-[.98]">{authed ? "进入工作区" : "登录"}<span className="grid h-6 w-6 place-items-center rounded-full bg-[#e50059] text-white transition group-hover:translate-x-0.5"><Arrow /></span></button></div>
          </nav>

          <div className="relative z-10 mx-auto flex w-full max-w-[1320px] flex-1 items-center" style={introStyle}>
            <div className="w-full pb-8 sm:pb-0">
              <p className="mb-3 font-mono text-[10px] uppercase tracking-[.2em] text-white/75 sm:mb-5">FableGlitch / AI film production workspace</p>
              <div className="h-[clamp(112px,18vw,250px)] max-w-[860px]"><ParticleText text="MAKE" particleSize={2.2} density={4.2} color="#ffffff" highlightColor="#7effd4" scatter={190} gatherDuration={1650} stagger={460} pointerRepel={46} repelRadius={140} fontSize="clamp(5.4rem, 17vw, 14rem)" fontWeight={900} fontFamily="var(--font-display)" /></div>
              <div className="ml-[clamp(12px,7vw,100px)] mt-[-.04em]"><EchoText text="WORLDS" echoes={13} lag={0.2} offset={31} direction="diagonal" fade={0.7} blur={2.5} tint="#ff96bd" fontSize="clamp(3.85rem, 15.2vw, 12.5rem)" fontWeight={900} color="#ffffff" /></div>
              <div className="mt-[-.03em]"><DepthText text="MOVE." layers={28} depth={2.8} faceColor="#ffffff" depthColor="#9d003c" tilt={5} autoOrbit orbitSpeed={0.28} fontSize="clamp(3.85rem, 16.3vw, 13.5rem)" fontWeight={900} /></div>
              <div className="mt-7 flex max-w-[680px] flex-wrap items-center gap-x-5 gap-y-3 text-[12px] leading-relaxed text-white/80 sm:mt-9 sm:text-[14px]"><p className="max-w-[44ch]">从故事和角色出发，让镜头、提示词、无限画布与生成结果在同一条创作线上流动。</p><span className="hidden h-7 w-px bg-white/30 sm:block" /><span className="font-mono text-[10px] uppercase tracking-[.16em] text-white/65">scroll to enter ↓</span></div>
            </div>
          </div>
          <div className="relative z-10 flex items-end justify-between gap-5 border-t border-white/25 pt-4 text-[10px] font-mono uppercase tracking-[.14em] text-white/70"><span>01 — Imagine, structure, make.</span><span className="hidden sm:block">FABLEGLITCH / FG STUDIO / 2026</span></div>
        </div>
      </section>

      <section ref={heroRef} className="relative min-h-[142svh] bg-[#e50059]" aria-label="FG Studio 创作入口">
        <div className="sticky top-0 h-[100svh] min-h-[700px] overflow-hidden">
          <img src="/fg-hero-magenta.png" alt="FG Studio 角色融入洋红创作场景" className="absolute inset-0 h-full w-full object-cover object-[60%_center] sm:object-center" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(226,0,81,.92)_0%,rgba(229,0,89,.54)_46%,rgba(229,0,89,.05)_80%)]" />
          <div className="pointer-events-none absolute inset-0 opacity-55 [background-image:radial-gradient(rgba(255,255,255,.24)_1px,transparent_1px)] [background-size:18px_18px]" />
          <div className="relative z-10 flex h-full flex-col px-5 pb-7 pt-5 sm:px-9 sm:pb-9 sm:pt-7 lg:px-12">
            <div className="flex justify-end"><a href="#tools" className="rounded-full border border-white/35 bg-[#e50059]/30 px-4 py-2 font-mono text-[10px] uppercase tracking-[.16em] text-white backdrop-blur-md transition hover:bg-white/15">进入创作地图 ↓</a></div>
            <div className="flex flex-1 items-center" style={heroStyle}><div className="max-w-[620px]"><p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/35 bg-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.16em] text-white/85 backdrop-blur-md"><span className="h-1.5 w-1.5 rounded-full bg-[#7effd4] shadow-[0_0_12px_#7effd4]" /> everything stays in the frame</p><h1 className="font-disp text-[clamp(45px,7.8vw,124px)] font-semibold leading-[.78] tracking-[-.075em]">把创作，<br /><span className="text-white/45">做成一条线。</span></h1><p className="mt-7 max-w-[42ch] text-[14px] leading-relaxed text-white/84 sm:text-[16px]">不再让剧本、参考图、镜头、提示词和生成结果散落在不同窗口。FG Studio 把它们串进同一张可继续生长的制作地图。</p><div className="mt-8 flex flex-wrap gap-3"><SpecularButton onClick={enterWorkspace} size="sm" radius={999} tint="#121019" tintOpacity={0.86} lineColor="#ffffff" baseColor="#ff83b4" textColor="#ffffff" intensity={1.25} autoAnimate className="!px-5 !py-3 !text-[13px]"><span className="inline-flex items-center gap-3">开始一个项目 <Arrow /></span></SpecularButton><Link href="/creator#/canvas" className="inline-flex items-center gap-2 rounded-full border border-white/45 bg-white/[.08] px-5 py-3 text-[13px] font-medium text-white backdrop-blur transition hover:bg-white/15"><Spark /> 打开无限画布</Link></div></div></div>
            <div className="flex items-end justify-between border-t border-white/25 pt-4 text-[10px] font-mono uppercase tracking-[.14em] text-white/70"><span>02 — Connect, direct, render.</span><span className="hidden sm:block">THE CHARACTER LIVES IN THE WORKFLOW</span></div>
          </div>
        </div>
      </section>

      <section id="tools" className="relative overflow-hidden bg-[#c8004d] px-5 py-20 sm:px-9 sm:py-28 lg:px-12">
        <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(255,255,255,.16)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.16)_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="relative mx-auto grid max-w-[1320px] gap-10 lg:grid-cols-[minmax(0,.92fr)_minmax(450px,1.08fr)] lg:items-center"><div><p className="font-mono text-[11px] uppercase tracking-[.18em] text-[#ffd4e2]">A workspace with memory.</p><MaskedHeading text="每一次好结果，都是下一次的开场。" tag="h2" src="/fg-hero-magenta.png" mediaType="image" reveal="wipe" trigger="view" duration={1.18} stagger={0.09} fillScale={1.2} className="mt-5 max-w-[10ch] font-disp text-[clamp(50px,7vw,100px)] leading-[.84] tracking-[-.075em]" /><p className="mt-8 max-w-[40ch] text-[15px] leading-relaxed text-white/82">把稳定角色、好镜头、靠谱提示词和完整资产留在团队的创作系统里。下一次从已验证的结果出发，而不是从聊天记录里重新找。</p><div className="mt-9 grid max-w-[560px] gap-2.5">{[["01", "无限画布", "把参考、文字、图片和视频连起来", "/creator#/canvas"], ["02", "导演项目", "从剧本到逐镜头设计", "/workspace"], ["03", "模型工作台", "对话、生图、生视频与用量", "/creator"]].map(([no, title, desc, href]) => (<Link key={no} href={href} className="group flex items-center gap-4 rounded-2xl border border-white/25 bg-[#9f003e]/45 px-4 py-4 backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-[#7d0032]/65"><span className="font-mono text-[10px] text-[#7effd4]">{no}</span><span className="min-w-0 flex-1"><b className="block text-[15px]">{title}</b><small className="mt-0.5 block text-[12px] text-white/65">{desc}</small></span><span className="text-[#7effd4] transition group-hover:translate-x-1"><Arrow /></span></Link>))}</div></div>
          <div className="grid gap-4 sm:grid-cols-2"><div className="relative h-[270px] overflow-hidden rounded-[26px] border border-white/25 bg-[#8f0038] shadow-[0_25px_56px_rgba(94,0,39,.35)] sm:h-[330px]"><ElasticMesh image="/fg-hero-magenta.png" color1="#f60062" color2="#7a0035" highlight="#ffffff" gridColor="#ffd2e3" gridOpacity={0.22} gridDensity={16} borderRadius={26} interaction="hover" className="absolute inset-0" /><span className="pointer-events-none absolute bottom-4 left-4 rounded-full border border-white/25 bg-[#a1003f]/70 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[.14em] text-white backdrop-blur">stretch the frame</span></div><div className="relative h-[270px] overflow-hidden rounded-[26px] border border-white/25 bg-[#8f0038] shadow-[0_25px_56px_rgba(94,0,39,.35)] sm:h-[330px]"><RippleDistortion src="/fg-hero-magenta.png" brushSize={132} strength={0.15} swirl={0.7} rings={4} spread={4} fade={3.8} tint="#ff0064" tintAmount={0.22} grayscale={false} trigger="hover" quality="low" className="absolute inset-0" /><span className="pointer-events-none absolute bottom-4 left-4 rounded-full border border-white/25 bg-[#a1003f]/70 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[.14em] text-white backdrop-blur">touch the motion</span></div><div className="sm:col-span-2"><div className="h-[430px] overflow-hidden rounded-[26px] border border-white/25 bg-[#74002f] shadow-[0_25px_56px_rgba(94,0,39,.35)]"><DepthCarousel items={CAROUSEL_ITEMS} cardWidth={238} cardHeight={300} radius={20} tint="#520020" depth={180} spread={76} visibleCards={3} autoplay autoplayDelay={3500} className="h-full" /></div></div></div>
        </div>
      </section>

      <section id="method" className="relative overflow-hidden bg-[#0b0c13] px-5 py-20 sm:px-9 sm:py-28 lg:px-12">
        <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:radial-gradient(rgba(255,255,255,.32)_1px,transparent_1px)] [background-size:16px_16px]" />
        <div className="relative mx-auto grid max-w-[1320px] gap-14 lg:grid-cols-[.9fr_1.1fr] lg:items-start"><div><p className="font-mono text-[11px] uppercase tracking-[.17em] text-[#60e5ff]">A production system with a memory.</p><h2 className="mt-5 font-disp text-[clamp(42px,6.2vw,92px)] font-semibold leading-[.84] tracking-[-.075em]">导演工作台，<br /><span className="text-white/35">也是资产库。</span></h2><p className="mt-8 max-w-[42ch] text-[15px] leading-relaxed text-white/68">无论独立制作还是团队协作，结果都能回到项目、镜头和资产库里；同时保留模型用量、预算和每个阶段的上下文。</p><button onClick={enterWorkspace} className="mt-9 inline-flex items-center gap-3 rounded-full bg-[#60e5ff] px-5 py-3 text-[13px] font-semibold text-[#06151b] transition hover:brightness-110 active:scale-[.98]">进入你的工作区 <Arrow /></button></div><div className="divide-y divide-white/15 border-y border-white/15">{STAGES.map(([no, title, desc]) => (<div key={no} className="group grid grid-cols-[auto_1fr_auto] items-center gap-4 py-5 sm:grid-cols-[64px_200px_1fr_auto]"><span className="font-mono text-[11px] text-[#60e5ff]">{no}</span><b className="font-disp text-[18px] font-medium tracking-tight">{title}</b><span className="hidden text-[13px] text-white/55 sm:block">{desc}</span><span className="text-white/35 transition group-hover:translate-x-1 group-hover:text-[#60e5ff]"><Arrow /></span></div>))}</div></div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 bg-[#0b0c13] px-5 py-8 text-[11px] text-white/45 sm:px-9 lg:px-12"><span className="inline-flex items-center gap-2 font-medium text-white"><FGLogo size={22} /> FG STUDIO</span><span>FableGlitch AI production workspace</span><Link href="/login" className="transition hover:text-[#7effd4]">登录工作区 <span aria-hidden="true">↗</span></Link></footer>

      {showAuth && <div className="fixed inset-0 z-[100] grid place-items-center bg-[#08080c]/75 p-5 backdrop-blur-md" onClick={() => !busy && setShowAuth(false)}><div className="w-[420px] max-w-full rounded-[25px] border border-white/15 bg-[#17171f]/95 p-7 text-white shadow-[0_30px_80px_rgba(0,0,0,.55)]" onClick={(event) => event.stopPropagation()}><div className="mb-5 flex items-start justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-[.18em] text-[#60e5ff]">FG STUDIO / ACCESS</div><h3 className="mt-2 font-disp text-[25px] font-semibold tracking-tight">{mode === "signin" ? "登录工作区" : "注册账号"}</h3></div><button onClick={() => !busy && setShowAuth(false)} className="grid h-8 w-8 place-items-center rounded-full border border-white/15 text-white/65 transition hover:bg-white/10 hover:text-white" aria-label="关闭">×</button></div>{mode === "signup" ? <div className="mb-3 flex overflow-hidden rounded-xl border border-white/15 bg-white/[.05] focus-within:border-[#60e5ff]"><input className="min-w-0 flex-1 bg-transparent px-3.5 py-3 text-[15px] text-white outline-none placeholder:text-white/35" value={username} placeholder="例如：meilinte" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => setUsername(normalizeCompanyUsername(event.target.value))} /><span className="flex items-center border-l border-white/10 px-3 text-[13px] text-[#60e5ff]">@beva.com</span></div> : <input className="mb-3 w-full rounded-xl border border-white/15 bg-white/[.05] px-3.5 py-3 text-[15px] text-white outline-none placeholder:text-white/35 focus:border-[#60e5ff]" value={email} placeholder="yourname@beva.com" autoCapitalize="none" onChange={(event) => setEmail(event.target.value)} />}<input className="w-full rounded-xl border border-white/15 bg-white/[.05] px-3.5 py-3 text-[15px] text-white outline-none placeholder:text-white/35 focus:border-[#60e5ff]" type="password" value={password} placeholder="密码（至少 6 位）" onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submit()} />{message && <p className="mt-3 text-[13px] leading-relaxed text-[#ffb0c4]">{message}</p>}<button disabled={busy} onClick={submit} className="mt-4 w-full rounded-full bg-[#60e5ff] py-3 text-[14px] font-semibold text-[#08161d] transition hover:brightness-110 disabled:opacity-55">{busy ? "处理中…" : mode === "signin" ? "登录" : "注册并登录"}</button><p className="mt-5 text-center text-[13px] text-white/55">{mode === "signin" ? "还没有账号？" : "已有账号？"} <button className="font-medium text-[#60e5ff] hover:underline" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); }}>{mode === "signin" ? "去注册" : "去登录"}</button></p><p className="mt-5 border-t border-white/10 pt-4 text-[11px] leading-relaxed text-white/40">注册仅允许公司 <b className="text-[#60e5ff]">@beva.com</b> 邮箱。</p></div></div>}
    </main>
  );
}
