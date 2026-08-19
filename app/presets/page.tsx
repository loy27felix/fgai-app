import { redirect } from "next/navigation";
import { createClient } from "@/lib/local/server";
import PresetLibrary from "@/components/PresetLibrary";

export const dynamic = "force-dynamic";

export default async function PresetsPage() {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) redirect("/");
  return <PresetLibrary email={user.email || ""} />;
}
