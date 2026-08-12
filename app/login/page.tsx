"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { companyEmailFromUsername, normalizeCompanyUsername } from "@/lib/auth/company-email";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setMsg("");
    const e = mode === "signup" ? companyEmailFromUsername(signupUsername) : email.trim().toLowerCase();
    if (!e) { setMsg("请输入 @beva.com 前的邮箱用户名"); return; }
    if (pw.length < 6) { setMsg("密码至少 6 位"); return; }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email: e, password: pw });
        if (error) throw error;
        const { data } = await supabase.auth.getSession();
        if (data.session) { router.replace("/projects"); router.refresh(); }
        else setMsg("注册成功，请到邮箱点确认链接后再登录。");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: e, password: pw });
        if (error) throw error;
        router.replace("/projects"); router.refresh();
      }
    } catch (err: any) { setMsg(err?.message || "出错了，请重试"); }
    finally { setBusy(false); }
  }

  return (
    <main className="auth-shell relative grid place-items-center overflow-y-auto bg-[#08080c] p-6 text-white overscroll-none">
      <div className="pointer-events-none absolute inset-0">
        <div className="orb absolute left-1/2 top-[-10%] h-[620px] w-[620px] -translate-x-1/2 opacity-55" />
        <div className="grain" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#08080c]/40 to-[#08080c]" />
      </div>

      <div className="relative z-10 w-[440px] max-w-full">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2.5 font-disp text-lg font-semibold text-white">
          <span className="pop-grad grid h-8 w-8 place-items-center rounded-lg text-[13px] font-bold text-black">FG</span>
          FG Studio
        </Link>
        <div className="rounded-[24px] border border-white/12 bg-white/[.04] p-9 shadow-[0_30px_80px_-30px_rgba(0,0,0,.8)] backdrop-blur-2xl">
          <div className="mb-1 font-mono text-[11px] uppercase tracking-wider text-cyan">FableGlitch · AI 漫剧</div>
          <h1 className="font-disp text-[26px] font-semibold tracking-tight">{mode === "signin" ? "登录工作台" : "注册账号"}</h1>
          <p className="mb-6 mt-1.5 text-sm text-white/55">用公司邮箱开始你的 AI 漫剧项目。</p>

          <label className="mb-1.5 block font-mono text-[10.5px] uppercase tracking-wide text-white/45">{mode === "signup" ? "公司邮箱用户名" : "邮箱"}</label>
          {mode === "signup" ? (
            <div className="mb-4 flex overflow-hidden rounded-xl border border-white/12 bg-white/[.05] transition focus-within:border-violet focus-within:bg-white/[.08]">
              <input className="min-w-0 flex-1 bg-transparent px-3.5 py-3 text-[15px] text-white outline-none placeholder:text-white/30" value={signupUsername} placeholder="例如：meilinle" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(ev) => setSignupUsername(normalizeCompanyUsername(ev.target.value))} />
              <span className="flex items-center border-l border-white/10 bg-white/[.035] px-3 text-[14px] text-cyan">@beva.com</span>
            </div>
          ) : <input className="mb-4 w-full rounded-xl border border-white/12 bg-white/[.05] px-3.5 py-3 text-[15px] text-white outline-none transition placeholder:text-white/30 focus:border-violet focus:bg-white/[.08]" value={email} placeholder="yourname@beva.com" autoCapitalize="none" onChange={(ev) => setEmail(ev.target.value)} />}
          <label className="mb-1.5 block font-mono text-[10.5px] uppercase tracking-wide text-white/45">密码</label>
          <input className="mb-2 w-full rounded-xl border border-white/12 bg-white/[.05] px-3.5 py-3 text-[15px] text-white outline-none transition placeholder:text-white/30 focus:border-violet focus:bg-white/[.08]"
            type="password" value={pw} placeholder="至少 6 位" onChange={(ev) => setPw(ev.target.value)} onKeyDown={(ev) => ev.key === "Enter" && submit()} />

          {msg && <div className="mb-2 mt-1 text-[13px] font-medium text-coral">{msg}</div>}

          <button className="pop-grad mt-3 w-full rounded-pill py-3.5 text-sm font-semibold text-black transition hover:-translate-y-0.5 disabled:opacity-60"
            disabled={busy} onClick={submit}>{busy ? "处理中…" : mode === "signin" ? "登录 →" : "注册并登录 →"}</button>

          <div className="mt-5 text-center text-[13px] text-white/55">
            {mode === "signin" ? "还没有账号？" : "已有账号？"}{" "}
            <button className="font-medium text-cyan hover:underline" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMsg(""); }}>
              {mode === "signin" ? "去注册" : "去登录"}
            </button>
          </div>
          <p className="mt-5 border-t border-white/8 pt-4 text-[12px] leading-relaxed text-white/40">
            注册仅限公司 <b className="text-cyan">@beva.com</b> 邮箱；登录可使用已有的白名单账号。
          </p>
        </div>
      </div>
    </main>
  );
}
