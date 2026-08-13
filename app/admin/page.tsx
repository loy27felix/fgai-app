import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AdminConsole from "@/components/AdminConsole";
import { getUsdToCnyRate } from "@/lib/usage/fx";
import { isMonthStartKey, monthRangeForKey, monthStartKey } from "@/lib/usage/budget";
import { withEligibleCatalogEstimate } from "@/lib/usage/reporting";

export const dynamic = "force-dynamic";

export default async function AdminPage({ searchParams }: { searchParams?: { month?: string | string[] } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: me } = await supabase.from("profiles").select("platform_role").eq("id", user.id).maybeSingle();
  const myRole = me?.platform_role as string | undefined;

  if (myRole !== "admin" && myRole !== "superadmin") {
    return (<div className="min-h-screen grid place-items-center px-6 text-center"><div><h2 className="font-disp text-2xl font-semibold">无权访问</h2><p className="mt-3 text-[#616161] dark:text-white/55">管理后台仅限 管理员 / 超级管理员。</p><Link href="/projects" className="pill mt-6 inline-flex">← 返回项目列表</Link></div></div>);
  }

  const rawMonth = typeof searchParams?.month === "string" ? searchParams.month.trim() : "";
  const requestedMonthStart = rawMonth ? `${rawMonth}-01` : monthStartKey();
  const monthStart = isMonthStartKey(requestedMonthStart) ? requestedMonthStart : monthStartKey();
  const monthRange = monthRangeForKey(monthStart);
  const [{ data: profiles }, { data: whitelist }, { data: usage }, { data: budgets }] = await Promise.all([
    supabase.from("profiles").select("id,email,platform_role,created_at").order("created_at", { ascending: true }),
    supabase.from("whitelist").select("*").order("requested_at", { ascending: false }),
    supabase.from("ai_usage_ledger")
      .select("id,request_id,provider_request_id,user_id,workspace_id,project_id,kind,provider,model,input_tokens,output_tokens,total_tokens,image_count,video_seconds,duration_ms,resolution,generate_audio,reported_cost_usd,estimated_cost_usd,cost_source,status,possibly_charged,created_at")
      .gte("created_at", monthRange.start)
      .lt("created_at", monthRange.end)
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase.from("ai_usage_budgets").select("user_id,month_start,limit_usd").eq("month_start", monthStart),
  ]);
  const usdToCnyRate = getUsdToCnyRate();

  return (
    <AdminConsole meId={user.id} isSuperadmin={myRole === "superadmin"} profiles={profiles || []} whitelist={whitelist || []} usage={(usage || []).map((row) => withEligibleCatalogEstimate(row))} budgets={budgets || []} monthStart={monthStart} usdToCnyRate={usdToCnyRate} email={user.email || ""} />
  );
}
