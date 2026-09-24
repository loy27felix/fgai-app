"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Empty, Form, Input, Modal, Segmented, Select, Space, Table, Tag } from "antd";
import { Archive, ArrowDownUp, CircleDollarSign, Clock3, FolderKanban, History, Plus, RefreshCw, UsersRound, WalletCards } from "lucide-react";
import styles from "./ProductionLabAdmin.module.css";

type Group = { id: string; name: string; createdAt: string; archivedAt: string | null; memberCount: number };
type Person = { id: string; email: string; displayName: string; platformRole: string; createdAt: string; groupId: string | null; groupName: string | null };
type HistoryItem = { id: string; actor_id: string; action: string; group_id: string | null; details: Record<string, unknown>; created_at: string };
type Directory = { groups: Group[]; users: Person[]; membershipHistory: { id: string; userId: string; groupId: string; groupName: string; assignedAt: string; unassignedAt: string | null; assignedBy: string; unassignedBy: string | null }[]; events: HistoryItem[] };
type SpendLine = { settledUsd: number; reportedUsd: number; estimatedUsd: number; unknownCount: number; settledCny: number; reportedCny: number; estimatedCny: number; requests: number; imageJobs: number; videoJobs: number; scriptRuns: number; totalTokens: number };
type ReportPerson = SpendLine & { userId: string; email: string; name: string; platformRole: string; currentGroup: string | null };
type ReportProject = SpendLine & { projectId: string; title: string; tier: string; stage: string; team: string; ownerName: string; ownerEmail: string; budgetCny: number };
type ReportGroup = SpendLine & { groupId: string; name: string; memberCount: number };
type Report = { totals: SpendLine; people: ReportPerson[]; projects: ReportProject[]; groups: ReportGroup[]; currency: { rate: number; source: string }; coverage: { mediaJobs: number; mediaJobsTotal: number; scriptRuns: number; scriptRunsTotal: number; maxRows: number; complete: boolean; unreconciledMediaJobs: number; unreconciledScriptRuns: number; unlinkedProjectRequests: number } };

const roleLabel: Record<string, string> = { superadmin: "超级管理员", admin: "管理员", user: "成员" };
const eventLabel: Record<string, string> = { group_created: "新建小组", group_renamed: "修改小组名称", group_archived: "停用小组", member_assignment_changed: "调整成员归属" };
const displayTime = (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false });
const fmt = (value: number, currency: "CNY" | "USD" = "CNY") => new Intl.NumberFormat("zh-CN", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
const details = (value: unknown) => value && typeof value === "object" ? value as Record<string, unknown> : {};

export default function ProductionLabAdmin({ demo, appearance }: { demo: boolean; appearance: "light" | "dark" }) {
  const { message, modal } = App.useApp();
  const [section, setSection] = useState("teams");
  const [reportView, setReportView] = useState("people");
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [directoryError, setDirectoryError] = useState("");
  const [reportError, setReportError] = useState("");
  const [search, setSearch] = useState("");
  const [mutating, setMutating] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [renaming, setRenaming] = useState<Group | null>(null);
  const [createForm] = Form.useForm<{ name: string }>();
  const [renameForm] = Form.useForm<{ name: string }>();

  async function loadDirectory() {
    if (demo) return;
    setLoadingDirectory(true); setDirectoryError("");
    try {
      const response = await fetch("/api/production-lab/admin?view=directory", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "小组与账号读取失败");
      setDirectory(body as Directory);
    } catch (error) { setDirectoryError(error instanceof Error ? error.message : "小组与账号读取失败"); }
    finally { setLoadingDirectory(false); }
  }
  async function loadReport() {
    if (demo) return;
    setLoadingReport(true); setReportError("");
    try {
      const response = await fetch("/api/production-lab/admin?view=report", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "费用报表读取失败");
      setReport(body as Report);
    } catch (error) { setReportError(error instanceof Error ? error.message : "费用报表读取失败"); }
    finally { setLoadingReport(false); }
  }
  async function refresh() { await Promise.all([loadDirectory(), loadReport()]); }
  useEffect(() => { void refresh(); }, [demo]);

  async function mutate(action: string, payload: Record<string, unknown>) {
    setMutating(action);
    try {
      const response = await fetch("/api/production-lab/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "保存失败");
      message.success(body.unchanged ? "成员已在此小组" : "调整已保存；历史归属保留");
      await refresh(); return true;
    } catch (error) { message.error(error instanceof Error ? error.message : "保存失败"); return false; }
    finally { setMutating(""); }
  }
  function openCreate() { createForm.resetFields(); setCreateOpen(true); }
  function openRename(group: Group) { renameForm.setFieldsValue({ name: group.name }); setRenaming(group); }
  function confirmArchive(group: Group) {
    modal.confirm({ title: `停用「${group.name}」？`, content: "小组及历史费用会保留；停用后不能再分配新成员。", okText: "停用小组", cancelText: "取消", onOk: async () => { const success = await mutate("archiveGroup", { groupId: group.id }); if (!success) throw new Error("停用失败"); } });
  }

  const activeGroups = useMemo(() => (directory?.groups || []).filter((group) => !group.archivedAt), [directory]);
  const filteredUsers = useMemo(() => (directory?.users || []).filter((person) => `${person.displayName} ${person.email} ${person.groupName || "未分组"}`.toLowerCase().includes(search.trim().toLowerCase())), [directory, search]);
  const currentMembers = (groupId: string) => (directory?.users || []).filter((person) => person.groupId === groupId);
  const totals = report?.totals;
  const headerActions = <Button icon={<RefreshCw size={14} />} loading={loadingDirectory || loadingReport} onClick={() => void refresh()}>刷新数据</Button>;

  function renderSpendAmounts(row: SpendLine) {
    return <div className={styles.amountStack}>
      <span className={styles.recordedTotal}>已记录费用小计<strong>{fmt(row.settledCny + row.reportedCny)}</strong></span>
      <span><i className={styles.invoiceDot} />已核销 <strong>{fmt(row.settledCny)}</strong></span>
      <span><i className={styles.reportDot} />服务商回报 <strong>{fmt(row.reportedCny)}</strong></span>
      <span><i className={styles.estimateDot} />费率参考（非实际） <strong>{fmt(row.estimatedCny)}</strong></span>
    </div>;
  }

  const peopleColumns = [
    { title: "平台账号", dataIndex: "email", render: (_: string, row: ReportPerson) => <div className={styles.identity}><strong>{row.name}</strong><span>{row.email}</span></div> },
    { title: "当前小组", dataIndex: "currentGroup", render: (value: string | null) => value || <Tag>未分组</Tag> },
    { title: "已发生费用", render: (_: unknown, row: ReportPerson) => renderSpendAmounts(row) },
    { title: "任务", render: (_: unknown, row: ReportPerson) => <div className={styles.countStack}><strong>{row.requests} 次</strong><span>图 {row.imageJobs} · 视频 {row.videoJobs} · 剧本 {row.scriptRuns}</span></div> },
    { title: "剧本 Token", dataIndex: "totalTokens", render: (value: number) => value.toLocaleString("zh-CN") },
  ];
  const projectColumns = [
    { title: "制作项目", dataIndex: "title", render: (_: string, row: ReportProject) => <div className={styles.identity}><strong>{row.title}</strong><span>{row.tier} 级 · {row.stage} · {row.team || "未分组"}</span></div> },
    { title: "项目负责人", dataIndex: "ownerName", render: (value: string, row: ReportProject) => <div className={styles.identity}><strong>{value || "未知"}</strong><span>{row.ownerEmail || "平台账号已不存在"}</span></div> },
    { title: "已发生费用", render: (_: unknown, row: ReportProject) => renderSpendAmounts(row) },
    { title: "计划预算", dataIndex: "budgetCny", render: (value: number) => value > 0 ? fmt(value) : <Tag>未设定</Tag> },
    { title: "任务", render: (_: unknown, row: ReportProject) => `${row.imageJobs} 图 · ${row.videoJobs} 视频 · ${row.scriptRuns} 剧本` },
  ];
  const groupSpendColumns = [
    { title: "费用归属小组", dataIndex: "name", render: (value: string) => value === "未归属小组" ? <Tag>{value}</Tag> : <strong>{value}</strong> },
    { title: "当前成员", dataIndex: "memberCount", render: (value: number) => `${value} 人` },
    { title: "已发生费用", render: (_: unknown, row: ReportGroup) => renderSpendAmounts(row) },
    { title: "任务", render: (_: unknown, row: ReportGroup) => `${row.requests} 次 · ${row.imageJobs} 图 / ${row.videoJobs} 视频 / ${row.scriptRuns} 剧本` },
  ];

  return <section className={styles.admin} data-theme={appearance}>
    <div className={styles.headline}>
      <div><div className={styles.eyebrow}>第六板块 · 超级管理员</div><h2>团队与费用</h2><p>动态管理小组和成员；按人员、项目分别查看已核销、服务商回报与费率参考。</p></div>
      <Space>{headerActions}{section === "teams" && <Button type="primary" icon={<Plus size={15} />} onClick={openCreate}>新建小组</Button>}</Space>
    </div>
    {demo ? <Alert type="info" showIcon message="演示模式不读取平台账号与费用账本" description="在第六板块的内测白名单账号中登录后，可使用小组管理与真实用量报表。" /> : <>
      <div className={styles.tabs}><Segmented value={section} onChange={(value) => setSection(String(value))} options={[{ value: "teams", label: <span className={styles.tabLabel}><UsersRound size={14} />小组与成员</span> }, { value: "spend", label: <span className={styles.tabLabel}><WalletCards size={14} />费用统计</span> }]} /></div>
      {section === "teams" && <>
        {directoryError && <Alert type="error" showIcon message={directoryError} action={<Button onClick={() => void loadDirectory()}>重试</Button>} />}
        <div className={styles.sectionIntro}><div><h3>小组设置</h3><p>人员调整会保留任职区间；费用按生成时的小组归属统计。</p></div><span>{activeGroups.length} 个在用小组 · {directory?.users.filter((user) => user.groupId).length || 0} 人已分组</span></div>
        <div className={styles.groupGrid}>
          {activeGroups.map((group, index) => <article className={styles.groupCard} key={group.id}>
            <div className={styles.groupTop}><div className={styles.groupMark}>{String(index + 1).padStart(2, "0")}</div><div className={styles.groupTitle}><strong>{group.name}</strong><span>{group.memberCount} 位成员</span></div><Button type="text" aria-label={`修改${group.name}名称`} onClick={() => openRename(group)}><ArrowDownUp size={15} /></Button><Button type="text" danger aria-label={`停用${group.name}`} onClick={() => confirmArchive(group)}><Archive size={15} /></Button></div>
            <div className={styles.memberChips}>{currentMembers(group.id).length ? currentMembers(group.id).map((member) => <Tag key={member.id}>{member.displayName}<small>{member.email}</small></Tag>) : <span>尚未分配成员</span>}</div>
            <Select key={`${group.id}-${group.memberCount}-${directory?.events.length || 0}`} className={styles.addMember} showSearch optionFilterProp="label" placeholder="添加成员 / 从其他小组调入" loading={loadingDirectory || Boolean(mutating)} options={(directory?.users || []).map((person) => ({ value: person.id, label: `${person.displayName} · ${person.email} · ${person.groupName || "未分组"}` }))} onChange={(userId: string) => void mutate("assignMember", { groupId: group.id, userId })} />
          </article>)}
          {!loadingDirectory && !activeGroups.length && <Empty description="还没有可用小组" />}
        </div>
        <div className={styles.sectionIntro}><div><h3>平台账号</h3><p>在这里可直接调组。账号来源于平台用户，不会在此创建或修改登录权限。</p></div><Input allowClear placeholder="搜索姓名、邮箱或小组" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <Table loading={loadingDirectory} rowKey="id" dataSource={filteredUsers} pagination={{ pageSize: 8, showSizeChanger: false }} locale={{ emptyText: directoryError || "没有匹配的平台账号" }} columns={[
          { title: "成员", dataIndex: "email", render: (_: string, person: Person) => <div className={styles.identity}><strong>{person.displayName}</strong><span>{person.email}</span></div> },
          { title: "平台角色", dataIndex: "platformRole", render: (role: string) => <Tag color={role === "superadmin" ? "purple" : role === "admin" ? "blue" : undefined}>{roleLabel[role] || role}</Tag> },
          { title: "当前小组", dataIndex: "groupId", render: (groupId: string | null, person: Person) => <Select aria-label={`${person.email}所在小组`} value={groupId || ""} loading={Boolean(mutating)} style={{ width: 210 }} options={[{ value: "", label: "未分组" }, ...activeGroups.map((group) => ({ value: group.id, label: group.name }))]} onChange={(value: string) => void mutate("assignMember", { userId: person.id, groupId: value || null })} /> },
          { title: "平台加入时间", dataIndex: "createdAt", render: (value: string) => displayTime(value) },
        ]} />
        <div className={styles.sectionIntro}><div><h3>最近调整记录</h3><p>小组创建、改名、停用和成员调动均留有记录。</p></div><History size={17} /></div>
        <Table size="small" rowKey="id" dataSource={directory?.events || []} pagination={{ pageSize: 6, showSizeChanger: false }} locale={{ emptyText: "暂无调整记录" }} columns={[
          { title: "时间", dataIndex: "created_at", render: (value: string) => displayTime(value) },
          { title: "操作", dataIndex: "action", render: (value: string) => eventLabel[value] || value },
          { title: "变更详情", render: (_: unknown, row: HistoryItem) => { const data = details(row.details); if (row.action === "member_assignment_changed") return <span>{String(data.email || "未知账号")}：{String(data.fromGroup || "未分组")} → {String(data.toGroup || "未分组")}</span>; if (row.action === "group_renamed") return <span>{String(data.from || "")} → {String(data.to || "")}</span>; return String(data.name || "-"); } },
          { title: "操作人", dataIndex: "actor_id", render: (value: string) => value === "system" ? "系统" : (directory?.users.find((user) => user.id === value)?.email || value.slice(0, 8)) },
        ]} />
      </>}
      {section === "spend" && <>
        {reportError && <Alert type="error" showIcon message={reportError} description="报表未加载完整，因此不会显示零值替代账单结果。" action={<Button onClick={() => void loadReport()}>重试</Button>} />}
        {totals && <>
          <div className={styles.costMetrics}>
            <div className={styles.metricInvoice}><CircleDollarSign size={17} /><span>WeToken 费用单精确核销</span><strong>{fmt(totals.settledCny)}</strong><small>{fmt(totals.settledUsd, "USD")} · 仅按 Reference ID 匹配</small></div>
            <div className={styles.metricReported}><WalletCards size={17} /><span>服务商返回金额</span><strong>{fmt(totals.reportedCny)}</strong><small>{fmt(totals.reportedUsd, "USD")} · 尚未以费用单核销</small></div>
            <div className={styles.metricEstimate}><FolderKanban size={17} /><span>模型费率估算</span><strong>{fmt(totals.estimatedCny)}</strong><small>{fmt(totals.estimatedUsd, "USD")} · 不是最终账单金额</small></div>
            <div className={styles.metricUnknown}><Clock3 size={17} /><span>暂无法计价请求</span><strong>{totals.unknownCount}</strong><small>{totals.requests.toLocaleString("zh-CN")} 条生成记录 · 全部项目</small></div>
          </div>
          <div className={styles.reportNote}><span>汇率 {report?.currency.rate} CNY / USD（{report?.currency.source === "USAGE_USD_TO_CNY_RATE" ? "服务端配置" : "当前展示配置"}）</span><span>图像、视频与剧本生成统一按账号和项目汇总；计划预算单独列示。</span></div>
          {!report?.coverage.complete && <Alert type="warning" showIcon message={`报表受读取上限影响：媒体任务 ${report?.coverage.mediaJobs.toLocaleString("zh-CN")} / ${report?.coverage.mediaJobsTotal.toLocaleString("zh-CN")}，剧本任务 ${report?.coverage.scriptRuns.toLocaleString("zh-CN")} / ${report?.coverage.scriptRunsTotal.toLocaleString("zh-CN")}。`} />}
          <div className={styles.sectionIntro}><div><h3>费用归集</h3><p>“已核销 / 服务商回报 / 估算”分开列示，不把预估账单合并成实际花费。</p></div><Segmented value={reportView} onChange={(value) => setReportView(String(value))} options={[{ value: "people", label: "按人员" }, { value: "projects", label: "按项目" }, { value: "groups", label: "按小组" }]} /></div>
          {reportView === "people" && <Table loading={loadingReport} rowKey="userId" dataSource={report?.people || []} pagination={{ pageSize: 10, showSizeChanger: false }} locale={{ emptyText: "尚无人员用量记录" }} columns={peopleColumns} />}
          {reportView === "projects" && <Table loading={loadingReport} rowKey="projectId" dataSource={report?.projects || []} pagination={{ pageSize: 10, showSizeChanger: false }} locale={{ emptyText: "尚无项目费用记录" }} columns={projectColumns} />}
          {reportView === "groups" && <Table loading={loadingReport} rowKey="groupId" dataSource={(report?.groups || []).filter((group) => group.groupId === "__unassigned__" || directory?.groups.some((item) => item.id === group.groupId))} pagination={false} locale={{ emptyText: "暂无小组费用记录" }} columns={groupSpendColumns} />}
          <div className={styles.coverageFoot}><span>费用单未核销：图片/视频 {report?.coverage.unreconciledMediaJobs || 0} 条 · 剧本 {report?.coverage.unreconciledScriptRuns || 0} 条</span><span>无法关联到当前立项的生成记录：{report?.coverage.unlinkedProjectRequests || 0} 条</span><span>汇总含当前平台所有账号的第六板块请求</span></div>
        </>}
      </>}
    </>}
    <Modal open={createOpen} title="新建制作小组" okText="创建小组" cancelText="取消" confirmLoading={Boolean(mutating)} onCancel={() => setCreateOpen(false)} onOk={() => createForm.submit()}>
      <Form form={createForm} layout="vertical" onFinish={async (values) => { if (await mutate("createGroup", { name: values.name })) setCreateOpen(false); }}><Form.Item name="name" label="小组名称" rules={[{ required: true, whitespace: true, message: "请输入小组名称" }, { max: 60, message: "最多 60 个字符" }]}><Input maxLength={60} placeholder="例如：漫剧 A 组" /></Form.Item><p className={styles.modalNote}>小组成员可以在任意时间调组；此前的费用会保留生成时的小组快照。</p></Form>
    </Modal>
    <Modal open={Boolean(renaming)} title={`修改小组名称${renaming ? ` · ${renaming.name}` : ""}`} okText="保存名称" cancelText="取消" confirmLoading={Boolean(mutating)} onCancel={() => setRenaming(null)} onOk={() => renameForm.submit()}>
      <Form form={renameForm} layout="vertical" onFinish={async (values) => { if (renaming && await mutate("renameGroup", { groupId: renaming.id, name: values.name })) setRenaming(null); }}><Form.Item name="name" label="小组名称" rules={[{ required: true, whitespace: true, message: "请输入小组名称" }, { max: 60, message: "最多 60 个字符" }]}><Input maxLength={60} /></Form.Item><p className={styles.modalNote}>已归档的小组名称快照不会改变；当前成员将显示新名称。</p></Form>
    </Modal>
  </section>;
}
