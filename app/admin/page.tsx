import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AdminConsole from "@/components/AdminConsole";
import { getUsdToCnyRate } from "@/lib/usage/fx";
import { estimateLedgerPrice } from "@/lib/usage/pricing";

export const dynamic = "force-dynamic";

function withKnownMediaEstimate(row: any) {
  if (row.reported_cost_usd != null || row.estimated_cost_usd != null) return row;
  const estimate = estimateLedgerPrice({
    kind: row.kind === "image" || row.kind === "video" ? row.kind : "text",
    model: String(row.model || ""),
    resolution: row.resolution,
    videoSeconds: row.video_seconds,
  });
  return estimate ? { ...row, estimated_cost_usd: estimate.estimatedCostUsd, cost_source: "estimated" } : row;
}

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

  if (myRole !== "admin" && myRole !== "superadmin") {
    return (<div className="min-h-screen grid place-items-center px-6 text-center"><div><h2 className="font-disp text-2xl font-semibold">无权访问</h2><p className="mt-3 text-[#616161] dark:text-white/55">管理后台仅限 管理员 / 超级管理员。</p><Link href="/projects" className="pill mt-6 inline-flex">← 返回项目列表</Link></div></div>);
  }

  const [{ data: profiles }, { data: whitelist }, { data: usage }, { data: projects }] = await Promise.all([
    supabase.from("profiles").select("id,email,platform_role,created_at").order("created_at", { ascending: true }),
    supabase.from("whitelist").select("*").order("requested_at", { ascending: false }),
    supabase.from("ai_usage_ledger")
      .select("user_id,kind,provider,model,input_tokens,output_tokens,total_tokens,image_count,video_seconds,resolution,generate_audio,reported_cost_usd,estimated_cost_usd,cost_source,status,possibly_charged,created_at")
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase.from("projects").select("id"),
  ]);
  const balance = await dsBalance();
  const usdToCnyRate = getUsdToCnyRate();

  return (
    <AdminConsole meId={user.id} isSuperadmin={myRole === "superadmin"} profiles={profiles || []} whitelist={whitelist || []} usage={(usage || []).map((row) => withKnownMediaEstimate(row))} projectCount={(projects || []).length} balance={balance} usdToCnyRate={usdToCnyRate} email={user.email || ""} />
  );
}
