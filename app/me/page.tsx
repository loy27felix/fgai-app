import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MeView from "@/components/MeView";

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

export default async function MePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const [{ data: profile }, { data: usage }, { data: gens }] = await Promise.all([
    supabase.from("profiles").select("email,platform_role,created_at").eq("id", user.id).maybeSingle(),
    supabase.from("ai_usage").select("model,total_tokens,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5000),
    supabase.from("generations").select("model,kind,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5000),
  ]);
  const balance = await dsBalance();

  return (
    <MeView
      email={profile?.email || user.email || ""}
      role={(profile?.platform_role as string) || "user"}
      joined={(profile?.created_at as string) || ""}
      usage={(usage || []) as any[]}
      gens={(gens || []) as any[]}
      balance={balance}
    />
  );
}
