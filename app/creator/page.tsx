import { redirect } from "next/navigation";
import InfiniteCanvasReferenceHost from "@/components/creator/InfiniteCanvasReferenceHost";
import { createClient } from "@/lib/local/server";

export const dynamic = "force-dynamic";

export default async function CreatorPage() {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) redirect("/login");
  return <InfiniteCanvasReferenceHost />;
}