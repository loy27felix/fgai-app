import { redirect } from "next/navigation";
import InfiniteCanvasReferenceHost from "@/components/creator/InfiniteCanvasReferenceHost";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CreatorPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <InfiniteCanvasReferenceHost />;
}