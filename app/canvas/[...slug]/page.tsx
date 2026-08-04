import { redirect } from "next/navigation";

type LegacyCanvasProjectPageProps = { params: { slug: string[] } };

export default function RootCanvasProjectPage({ params }: LegacyCanvasProjectPageProps) {
  const slug = (params.slug || []).filter(Boolean).map((part) => encodeURIComponent(part)).join("/");
  redirect(`/creator#/canvas${slug ? `/${slug}` : ""}`);
}
