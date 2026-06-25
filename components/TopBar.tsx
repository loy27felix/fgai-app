"use client";
import Link from "next/link";
import { signOut } from "@/app/projects/actions";
import ThemeToggle from "@/components/ThemeToggle";

export default function TopBar({ email, crumb, admin }: { email: string; crumb?: React.ReactNode; admin?: boolean }) {
  const initial = (email[0] || "U").toUpperCase();
  return (
    <header className="sticky top-0 z-30 flex h-[58px] items-center gap-2 glass-bar px-5">
      <Link href="/projects" className="flex items-center gap-2.5 font-disp text-base font-semibold">
        <span className="pop-grad grid h-7 w-7 place-items-center rounded-lg text-[12px] font-bold text-black">FG</span>
        <span className="hidden sm:block">FG Studio</span>
      </Link>
      <span className="text-[#d9d9dd]">/</span>
      <div className="flex items-center gap-2 text-sm text-muted">{crumb ?? <span>工作台</span>}</div>
      <div className="flex-1" />
      <nav className="hidden items-center gap-0.5 md:flex">
        <Link href="/" className="rounded-lg px-2.5 py-1.5 text-[13px] text-muted transition hover:bg-stone hover:text-ink">首页</Link>
        <Link href="/projects" className="rounded-lg px-2.5 py-1.5 text-[13px] text-muted transition hover:bg-stone hover:text-ink">项目</Link>
        <Link href="/presets" className="rounded-lg px-2.5 py-1.5 text-[13px] text-muted transition hover:bg-stone hover:text-ink">预设库</Link>
        {admin && <Link href="/admin" className="rounded-lg px-2.5 py-1.5 text-[13px] text-muted transition hover:bg-stone hover:text-ink">管理</Link>}
      </nav>
      <ThemeToggle />
      <form action={signOut}>
        <button className="rounded-lg border border-[#e5e7eb] px-3 py-1.5 text-[13px] transition hover:border-ink" title="退出登录">退出</button>
      </form>
      <Link href="/me" title="个人中心" className="grid h-8 w-8 place-items-center rounded-full bg-green text-[13px] font-semibold text-green-pale transition hover:opacity-80">{initial}</Link>
    </header>
  );
}
