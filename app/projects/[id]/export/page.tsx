import { redirect } from "next/navigation";

// ⑧ 拼接导出阶段已移除；保留路由仅作重定向到 ⑥ 生视频。
export default function ExportRemoved({ params }: { params: { id: string } }) {
  redirect(`/projects/${params.id}/video`);
}
