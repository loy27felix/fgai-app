import { redirect } from "next/navigation";
import InfiniteCanvasWorkspace from "@/components/creator/InfiniteCanvasWorkspace";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = { searchParams?: { kind?: string } };

export default async function InfiniteCanvasPage({ searchParams }: Props) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const kind = searchParams?.kind === "video" ? "video" : "image";
  return <InfiniteCanvasWorkspace userEmail={user.email || ""} initialKind={kind} />;
}
