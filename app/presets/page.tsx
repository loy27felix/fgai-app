import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PresetLibrary from "@/components/PresetLibrary";

export const dynamic = "force-dynamic";

export default async function PresetsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  return <PresetLibrary email={user.email || ""} />;
}
