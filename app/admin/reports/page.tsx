import { redirect } from "next/navigation";
import { createClient } from "@/lib/local/server";
import { getReportDetails, listReportRuns, type ReportRunRecord } from "@/lib/observability/reporting";
import PageShell from "@/components/studio/PageShell";
import ObservabilityReportView from "@/components/ObservabilityReportView";

export const dynamic = "force-dynamic";

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function valueOf(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

export default async function ReportsPage({ searchParams }: { searchParams?: { id?: string | string[]; q?: string | string[] } }) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) redirect("/");

  const { data: me } = await localClient.from("profiles").select("platform_role").eq("id", user.id).maybeSingle();
  const role = me?.platform_role as string | undefined;
  if (role !== "admin" && role !== "superadmin") redirect("/admin");

  let runs: ReportRunRecord[] = [];
  let detail: Awaited<ReturnType<typeof getReportDetails>> = null;
  let error = "";
  let search = "";
  try {
    const requestedId = valueOf(searchParams?.id);
    search = valueOf(searchParams?.q).trim().slice(0, 80);
    runs = await listReportRuns(40, { search });
    const selectedId = requestedId && validUuid(requestedId)
      ? requestedId
      : runs.find((run) => run.status === "succeeded")?.id || runs[0]?.id || "";
    if (selectedId) detail = await getReportDetails(selectedId);
  } catch (loadError) {
    console.error("[observability reports read failed]", loadError instanceof Error ? loadError.message : String(loadError));
    error = "报表数据暂时不可用，请确认数据库迁移和 report scheduler 已完成。";
  }

  return <PageShell title="监控报表" email={user.email || ""}>
    <ObservabilityReportView runs={runs} detail={detail} error={error} query={search} />
  </PageShell>;
}
