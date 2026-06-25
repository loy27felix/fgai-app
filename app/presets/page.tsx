import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/components/TopBar";
import PresetLibrary from "@/components/PresetLibrary";

export const dynamic = "force-dynamic";

export default async function PresetsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const { data: profile } = await supabase.from("profiles").select("platform_role").eq("id", user.id).maybeSingle();
  const isAdmin = profile?.platform_role === "admin" || profile?.platform_role === "superadmin";
  const crumb = (<><Link href="/projects" className="cursor-pointer">项目</Link><span className="opacity-40">/</span><b className="text-ink">预设库</b></>);
  return (
    <div className="min-h-screen">
      <TopBar email={user.email || ""} crumb={crumb} admin={isAdmin} />
      <PresetLibrary />
    </div>
  );
}
