import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/components/TopBar";
import AdminConsole from "@/components/AdminConsole";

export const dynamic = "force-dynamic";

async function dsBalance(): Promise<string | null> {
  try {
    const r = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` }, cache: "no-store",
    });
    if (!r.ok) return null;
    const d = await r.json();
    const b = d?.balance_infos?.[0];
    return b ? `${b.total_balance} ${b.currency}` : null;
  } catch { return null; }
}

export default async function AdminPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: me } = await supabase.from("profiles").select("platform_role").eq("id", user.id).maybeSingle();
  const myRole = me?.platform_role as string | undefined;
  const crumb = (<><Link href="/projects" className="cursor-pointer">项目</Link><span className="opacity-40">/</span><b className="text-ink">管理后台</b></>);

  if (myRole !== "admin" && myRole !== "superadmin") {
    return (
      <div className="min-h-screen"><TopBar email={user.email || ""} crumb={crumb} />
        <div className="mx-auto max-w-lg px-7 py-24 text-center">
          <h2 className="font-disp text-2xl font-semibold">无权访问</h2>
          <p className="mt-3 text-[#616161]">管理后台仅限 管理员 / 超级管理员。</p>
          <Link href="/projects" className="pill mt-6 inline-flex">← 返回项目列表</Link>
        </div></div>
    );
  }

  const [{ data: profiles }, { data: whitelist }, { data: usage }, { data: projects }] = await Promise.all([
    supabase.from("profiles").select("id,email,platform_role,created_at").order("created_at", { ascending: true }),
    supabase.from("whitelist").select("*").order("requested_at", { ascending: false }),
    supabase.from("ai_usage").select("model,total_tokens,created_at").order("created_at", { ascending: false }).limit(5000),
    supabase.from("projects").select("id"),
  ]);
  const balance = await dsBalance();

  return (
    <div className="min-h-screen">
      <TopBar email={user.email || ""} crumb={crumb} admin />
      <AdminConsole
        meId={user.id}
        isSuperadmin={myRole === "superadmin"}
        profiles={profiles || []}
        whitelist={whitelist || []}
        usage={usage || []}
        projectCount={(projects || []).length}
        balance={balance}
      />
    </div>
  );
}
