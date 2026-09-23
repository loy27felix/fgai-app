import { notFound } from "next/navigation";
import { labActor } from "@/lib/production-lab/access";
import CreativeWorkspace from "@/components/production-lab/CreativeWorkspace";

export const dynamic = "force-dynamic";
export default async function ProductionLabPage() {
  const actor = await labActor();
  if (!actor) notFound();
  return <CreativeWorkspace actor={actor} />;
}
