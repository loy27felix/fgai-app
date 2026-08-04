import { redirect } from "next/navigation";

export default function LegacyCanvasPage() {
  // Keep the legacy entry point useful: the creator host uses a MemoryRouter,
  // so the inner canvas route is carried in the hash rather than sent to
  // Next's server router.
  redirect("/creator#/canvas");
}