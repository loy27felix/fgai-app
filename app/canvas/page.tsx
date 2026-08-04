import { redirect } from "next/navigation";

export default function LegacyCanvasRootPage() {
  redirect("/creator#/canvas");
}
