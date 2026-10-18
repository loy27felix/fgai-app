import { useEffect, useRef, useState } from "react";
import {
  App as AntApp,
  Button,
  ConfigProvider,
  Drawer,
  Input,
  InputNumber,
  Modal,
  Select,
  Spin,
  Tag,
  Tooltip,
  theme,
} from "antd";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  CheckCheck,
  ChevronRight,
  Clapperboard,
  Copy,
  Download,
  FileText,
  Film,
  History,
  Image as ImageIcon,
  Menu,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import gsap from "gsap";
import zhCN from "antd/locale/zh_CN";
import {
  api,
  currentVersion,
  Config,
  Drama,
  DramaSummary,
  StudioArtifact,
} from "./api";
import { readAsDataUrl } from "./lib/files";
import "./studio.css";

const reportWorkspace = () => {
  if (window.parent !== window)
    window.parent.postMessage(
      {
        type: "fg-workspace-location",
        route:
          location.pathname.replace(/^\/fg-six/, "") +
          location.search +
          location.hash,
      },
      location.origin,
    );
};
const LABELS: Record<string, string> = {
  concept: "故事方案",
  characters: "人物圣经",
  world: "世界与规则",
  outline: "分场大纲",
  script: "完整剧本",
  audit: "剧本体检",
  assets: "角色与场景",
  storyboard: "导演分镜",
  prompts: "视频 Prompt",
  qc: "连续性质检",
};
const STATUS: Record<string, string> = {
  queued: "排队中",
  running: "正在生成",
  submitted: "已提交",
  confirmed: "已确认",
  archiving: "正在归档",
  recovering: "正在恢复连接",
  succeeded: "已完成",
  failed: "未完成",
  cancelled: "已取消",
  awaiting_confirmation: "待核对",
};
const MEDUSA =
  "我想做一部有男主的美杜莎题材 AI 短剧。开头就给强钩子：男主作为祭品被推进蛇神殿，所有人等着他石化，他却直视美杜莎毫发无伤。他发现诅咒的隐藏规则，主动把它变成反击的武器。要有清楚的男主目标、不断升级的压迫和有铺垫的爽感反转，动作快、衔接自然、魔法有因果。先和我确定故事方案。";
const vnow = (a: StudioArtifact) =>
  a.versions.find((v) => v.id === a.current) ||
  a.versions[a.versions.length - 1];
const money = (n: number | null | undefined) =>
  typeof n === "number"
    ? `¥${n.toLocaleString("zh-CN", { maximumFractionDigits: 5 })}`
    : "按用量结算";
const shortDate = (value: string) =>
  new Date(value).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
const download = (name: string, text: string) => {
  const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const LOCKS: Record<string, { name: string; values: string[] }> = {
  track: { name: "题材赛道", values: ["国内剧", "海外剧", "解说叙事", "其他"] },
  source: {
    name: "素材来源",
    values: ["原创", "改编", "对标爆款", "热点速成"],
  },
  action: {
    name: "表演与动作",
    values: ["文戏", "商业打戏", "玄幻仙侠", "真人写实"],
  },
  splice: {
    name: "段落衔接",
    values: ["末帧承接", "换机位硬切", "空镜过渡", "技巧型转场"],
  },
  style: {
    name: "视觉方向",
    values: ["电影写实", "动画漫剧", "按导演推荐", "沿用上传参考"],
  },
  delivery: {
    name: "交付方式",
    values: ["Markdown文稿", "在线制作看板", "两者都要"],
  },
};

export default function StudioRoot() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#e5b77b",
          colorBgBase: "#161817",
          colorText: "#f3eee6",
          colorTextSecondary: "#b8b8af",
          colorBorder: "#42453f",
          borderRadius: 10,
          fontFamily: '"Noto Sans SC", "Microsoft YaHei", sans-serif',
          controlHeight: 38,
        },
        components: {
          Modal: { contentBg: "#212420", headerBg: "#212420" },
          Drawer: { colorBgElevated: "#212420" },
        },
      }}
    >
      <AntApp>
        <StudioApp />
      </AntApp>
    </ConfigProvider>
  );
}
function StudioApp() {
  const { message, modal } = AntApp.useApp();
  const [config, setConfig] = useState<Config>(),
    [projects, setProjects] = useState<DramaSummary[]>([]),
    [drama, setDrama] = useState<Drama>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false),
    [choice, setChoice] = useState(""),
    [search, setSearch] = useState(""),
    [text, setText] = useState(""),
    [sidebar, setSidebar] = useState(false),
    [settings, setSettings] = useState(false),
    [review, setReview] = useState(false),
    [workspace, setWorkspace] = useState(true);
  const [selected, setSelected] = useState(""),
    [version, setVersion] = useState(""),
    [shotKey, setShotKey] = useState(""),
    [editing, setEditing] = useState(false),
    [editText, setEditText] = useState(""),
    [view, setView] = useState<"document" | "media">("document");
  const [generate, setGenerate] = useState<{
      artifactId: string;
      itemKey: string;
      kind: string;
      title: string;
    }>(),
    [genParams, setGenParams] = useState<Record<string, unknown>>({}),
    [sharing, setSharing] = useState(false),
    [memberEmail, setMemberEmail] = useState("");
  const root = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    fileRef = useRef<HTMLInputElement>(null),
    uploadCode = useRef<string>(),
    currentId = useRef(""),
    revisionFocus = useRef(""),
    editingRef = useRef(false),
    loadSequence = useRef(0);
  editingRef.current = editing;
  const d = drama,
    s = d?.studio,
    c = config?.chains?.find((c) => c.id === s?.chain),
    artifact = s?.artifacts.find((a) => a.id === selected),
    draft = artifact
      ? artifact.versions.find((v) => v.id === version) || vnow(artifact)
      : undefined;
  const shot =
      draft?.data.shots?.find((x) => x.key === shotKey) ||
      draft?.data.shots?.[0],
    running = s?.runs.find((r) => ["queued", "running"].includes(r.status)),
    pending = (d?.production || []).filter(
      (p) =>
        p.status === "awaiting_confirmation" && p.actorId === config?.actor?.id,
    ),
    editable = Boolean(d?.permissions?.canEdit);
  const refreshList = async () => setProjects(await api.list());
  const sync = (value: Drama) => {
    if (currentId.current !== value.id) return;
    setDrama(value);
    const a = value.studio?.artifacts.find((a) => a.id === value.studio?.focus),
      signature = a ? `${a.id}/${a.current}` : "";
    if (a && !editingRef.current && signature !== revisionFocus.current) {
      revisionFocus.current = signature;
      setSelected(a.id);
      setVersion("");
      setShotKey("");
      setView("document");
      setWorkspace(true);
    }
    void refreshList().catch(() => {});
  };
  const openProject = async (id: string) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    currentId.current = id;
    try {
      const value = await api.get(id);
      if (sequence !== loadSequence.current) return;
      setDrama(value);
      setSelected(value.studio?.focus || value.studio?.artifacts[0]?.id || "");
      setVersion("");
      setShotKey("");
      setEditing(false);
      setSidebar(false);
      const url = new URL(location.href);
      url.searchParams.set("project", id);
      history.replaceState(null, "", url);
      reportWorkspace();
    } catch (e) {
      if (sequence === loadSequence.current) setError((e as Error).message);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  };
  const init = async () => {
    setLoading(true);
    setError("");
    try {
      const [cfg, list] = await Promise.all([api.config(), api.list()]);
      setConfig(cfg);
      setProjects(list);
      const id = new URLSearchParams(location.search).get("project");
      if (id && list.some((p) => p.id === id)) await openProject(id);
      else setLoading(false);
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  };
  useEffect(() => {
    void init();
  }, []);
  useEffect(() => {
    if (!d) return;
    let disposed = false,
      polling = false;
    const id = d.id;
    const poll = async () => {
      if (polling || busy) return;
      polling = true;
      try {
        const value = await api.get(id);
        if (!disposed && currentId.current === id) sync(value);
      } catch {
        /* Preserve visible drafts through a temporary disconnect. */
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(poll, running ? 2000 : 6000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [d?.id, Boolean(running), busy]);
  useEffect(() => {
    if (
      !root.current ||
      !workspace ||
      !selected ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".artifact-surface",
        { x: 18, clipPath: "inset(0 0 0 3%)" },
        {
          x: 0,
          clipPath: "inset(0 0 0 0%)",
          duration: 0.42,
          ease: "expo.out",
          clearProps: "transform,clipPath",
        },
      );
    }, root);
    return () => ctx.revert();
  }, [selected, workspace]);
  useEffect(() => {
    scroll.current?.scrollTo({
      top: scroll.current.scrollHeight,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [d?.messages.length, running?.status]);
  const work = async (
    fn: () => Promise<{ project: Drama } | Drama>,
    done?: () => void,
  ) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      sync("project" in result ? result.project : result);
      done?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const act = (
    type: string,
    payload: Record<string, unknown> = {},
    done?: () => void,
  ) => d && work(() => api.studio(d.id, type, payload), done);
  const send = () => {
    if (!text.trim() || !d || !editable || running) return;
    const input = text;
    void act(
      "turn",
      {
        text:
          shot && artifact
            ? `当前展现：${artifact.title}，镜头 ${shot.key}（只在我的要求涉及它时修改）。\n${input}`
            : input,
        targetId: artifact?.id,
      },
      () => setText(""),
    );
  };
  const create = async (mode = "production") => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const value = await api.createStudio(
        mode === "audit" ? "prism" : choice,
        mode,
      );
      currentId.current = value.id;
      setDrama(value);
      setNewOpen(false);
      setSelected("");
      setVersion("");
      setText("");
      setSidebar(false);
      await refreshList();
      const url = new URL(location.href);
      url.searchParams.set("project", value.id);
      history.replaceState(null, "", url);
      reportWorkspace();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const chooseArtifact = (id: string) => {
    if (editing) {
      message.info("请先保存或取消编辑");
      return;
    }
    setSelected(id);
    setVersion("");
    setShotKey("");
    setWorkspace(true);
    setView("document");
  };
  const startGenerate = (
    a: StudioArtifact,
    key: string,
    kind: string,
    title: string,
  ) => {
    setGenerate({ artifactId: a.id, itemKey: key, kind, title });
    setGenParams(
      kind === "image"
        ? { ...d!.settings.imageParams }
        : {
            ratio: d!.settings.aspect,
            resolution: d!.settings.videoParams.preview,
          },
    );
  };
  const uploadFile = async (file: File) => {
    if (!d) return;
    const id = d.id,
      code = uploadCode.current;
    uploadCode.current = undefined;
    setBusy(true);
    setError("");
    try {
      const image = file.type.startsWith("image/"),
        dataUrl = await readAsDataUrl(file);
      const r = await api.upload(id, {
        dataUrl,
        name: file.name,
        purpose: image ? "asset" : "studio-script",
        ...(image ? { kind: "character", ...(code ? { code } : {}) } : {}),
      });
      sync(r.project);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const goHome = () => {
    ++loadSequence.current;
    currentId.current = "";
    setDrama(undefined);
    setSelected("");
    setError("");
    const url = new URL(location.href);
    url.searchParams.delete("project");
    history.replaceState(null, "", url);
    reportWorkspace();
  };
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success("已复制");
    } catch {
      message.error("复制未获允许，请在正文中选择文字复制");
    }
  };
  const liveModel =
      generate &&
      config?.models.find(
        (m) =>
          m.id ===
          (generate.kind === "image"
            ? d?.settings.imageModel
            : d?.settings.videoModel),
      ),
    total = pending.every((p) => typeof p.quote.estimatedCny === "number")
      ? pending.reduce((sum, p) => sum + p.quote.estimatedCny!, 0)
      : null;
  return (
    <div
      ref={root}
      className={`studio-shell ${workspace && d ? "with-workspace" : ""} ${sidebar ? "sidebar-open" : ""}`}
    >
      <aside className="project-sidebar">
        <a className="back-fg" href="/production-lab" target="_top">
          <ArrowLeft size={15} />
          FG 工作台
        </a>
        <button className="wordmark" onClick={goHome}>
          <Clapperboard size={25} />
          <span>
            美林<span>超级导演</span>
          </span>
        </button>
        <Button
          className="new-project"
          icon={<Plus size={16} />}
          onClick={() => {
            setChoice("");
            setNewOpen(true);
          }}
        >
          新的创作
        </Button>
        <button
          className="audit-entry"
          onClick={() => void create("audit")}
          disabled={busy}
        >
          <ShieldCheck size={18} />
          <span>
            剧本体检<small>先看看，值不值得拍</small>
          </span>
          <ChevronRight size={14} />
        </button>
        <Input
          aria-label="搜索项目"
          placeholder="搜索项目对话"
          prefix={<Search size={15} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <nav className="project-list" aria-label="项目对话">
          {projects
            .filter((p) =>
              `${p.titleZh} ${p.title}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((p) => (
              <div
                className={`project-row ${d?.id === p.id ? "active" : ""}`}
                key={p.id}
              >
                <button onClick={() => void openProject(p.id)}>
                  <MessageSquare size={15} />
                  <span>
                    {p.titleZh || p.title || "未命名创作"}
                    <small>
                      {shortDate(p.updatedAt)} · {p.episodes || 0} 集
                    </small>
                  </span>
                </button>
                {p.canDelete && (
                  <Tooltip title="删除项目">
                    <Button
                      type="text"
                      size="small"
                      aria-label={`删除${p.titleZh}`}
                      icon={<Trash2 size={13} />}
                      onClick={() =>
                        modal.confirm({
                          title: "删除这个项目？",
                          content: "项目会从列表移除，已产生费用不会撤销。",
                          okText: "删除项目",
                          okButtonProps: { danger: true },
                          cancelText: "保留",
                          onOk: async () => {
                            await api.remove(p.id);
                            if (d?.id === p.id) goHome();
                            await refreshList();
                          },
                        })
                      }
                    />
                  </Tooltip>
                )}
              </div>
            ))}
        </nav>
        <footer className="sidebar-footer">
          <span className="account-dot">
            {(config?.actor?.name || "FG").slice(0, 1)}
          </span>
          <div>
            {config?.actor?.name || "FG 创作成员"}
            <small>项目与生成记录持续保存</small>
          </div>
          <Button
            type="text"
            aria-label="刷新项目列表"
            icon={<RefreshCw size={15} />}
            onClick={() => void refreshList().catch((e) => setError(e.message))}
          />
        </footer>
      </aside>
      <main className="conversation">
        <header className="conversation-header">
          <Button
            className="mobile-menu"
            type="text"
            aria-label="项目列表"
            icon={<Menu size={19} />}
            onClick={() => setSidebar(!sidebar)}
          />
          <div>
            <h1>{d?.titleZh || "从故事，到银幕"}</h1>
            {d && (
              <span>
                {s?.mode === "audit" ? "独立剧本体检" : c?.name || "历史项目"}
                <i />
                {LABELS[s?.stage || "concept"]}
              </span>
            )}
          </div>
          {d && (
            <div className="header-actions">
              <Tooltip title="成员协作">
                <Button
                  type="text"
                  icon={<MessageSquare size={17} />}
                  aria-label="成员协作"
                  onClick={() => setSharing(true)}
                />
              </Tooltip>
              <Tooltip title="模型与制作要求">
                <Button
                  type="text"
                  icon={<Settings size={17} />}
                  aria-label="模型与制作要求"
                  onClick={() => setSettings(true)}
                />
              </Tooltip>
              <Tooltip title={workspace ? "收起展现区" : "展开展现区"}>
                <Button
                  type="text"
                  icon={
                    workspace ? (
                      <PanelRightClose size={19} />
                    ) : (
                      <PanelRightOpen size={19} />
                    )
                  }
                  aria-label="切换展现区"
                  onClick={() => setWorkspace(!workspace)}
                />
              </Tooltip>
            </div>
          )}
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <Button
              size="small"
              type="text"
              icon={<X size={15} />}
              aria-label="收起错误"
              onClick={() => setError("")}
            />
          </div>
        )}
        {loading ? (
          <div className="loading-page">
            <Spin />
            <p>正在读取你的创作…</p>
          </div>
        ) : !d ? (
          <div className="studio-welcome">
            <div className="welcome-frame">
              <Film size={42} strokeWidth={1} />
              <h2>
                好故事，
                <br />
                下一幕见。
              </h2>
              <p>
                告诉美林你想拍什么。一起写剧本、定角色、拆镜头，
                <br />
                让每一张图、每一段视频都有据可改。
              </p>
              <Button
                type="primary"
                size="large"
                icon={<Plus size={17} />}
                onClick={() => {
                  setChoice("");
                  setNewOpen(true);
                }}
              >
                开始一个新故事
              </Button>
              <button
                className="welcome-audit"
                onClick={() => void create("audit")}
              >
                已经有剧本？先做一次剧本体检
                <ChevronRight size={15} />
              </button>
            </div>
            <div className="welcome-notes">
              <span>一句想法，也能开始</span>
              <span>所有文稿都能对话修改</span>
              <span>图片与视频确认后生成</span>
            </div>
            {error && <Button onClick={() => void init()}>重新连接</Button>}
          </div>
        ) : (
          <>
            <div className="chat-scroll" ref={scroll}>
              <div className="chat-measure">
                {d.messages.map((m) => (
                  <article className={`chat-message ${m.role}`} key={m.id}>
                    <span className="message-avatar">
                      {m.role === "user" ? (
                        (config?.actor?.name || "我").slice(0, 1)
                      ) : (
                        <Clapperboard size={17} />
                      )}
                    </span>
                    <div>
                      <header>
                        {m.role === "user" ? "你" : "美林"}
                        <time>
                          {new Date(m.at).toLocaleTimeString("zh-CN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </header>
                      <div className="message-text">{m.text}</div>
                    </div>
                  </article>
                ))}
                {d.messages.length === 1 && s?.mode !== "audit" && (
                  <button
                    className="story-starter"
                    onClick={() => setText(MEDUSA)}
                  >
                    <Film size={18} />
                    <span>
                      试试：美杜莎的第一个不死祭品
                      <small>男主反击 · 强钩子 · 诅咒规则与爽感反转</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                )}
                {s?.questions.map((q) => (
                  <div className="agent-question" key={q.id}>
                    <p>{q.question}</p>
                    <div>
                      {q.options.map((answer, i) => (
                        <Button
                          key={i}
                          disabled={Boolean(running) || !editable}
                          onClick={() =>
                            setText(`${q.question}\n我的选择：${answer}`)
                          }
                        >
                          {answer}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
                {running && (
                  <div className="director-working" role="status">
                    <Spin size="small" />
                    <span>
                      {STATUS[running.status]} · {LABELS[running.phase]}
                      <small>
                        正在整理完整稿。可以离开页面，结果会自动保存。
                      </small>
                    </span>
                  </div>
                )}
                {s?.runs
                  .filter((r) => r.status === "failed")
                  .slice(-1)
                  .map((r) => (
                    <div className="run-error" key={r.id}>
                      <b>{LABELS[r.phase]}尚未完成</b>
                      <p>{r.error}</p>
                      <Button
                        size="small"
                        disabled={busy || Boolean(running)}
                        onClick={() => void act("retry", { id: r.id })}
                      >
                        恢复原任务
                      </Button>
                      <small>也可以描述新的修改要求继续。</small>
                    </div>
                  ))}
                {pending.length > 0 && (
                  <button
                    className="pending-banner"
                    onClick={() => setReview(true)}
                  >
                    <ShieldCheck size={20} />
                    <span>
                      {pending.length} 个生成方案等待核对
                      <small>模型、规格、完整 Prompt 与真实参考图</small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                )}
              </div>
            </div>
            <div className="composer-wrap">
              {artifact && (
                <div className="composer-target">
                  <FileText size={13} />
                  <span>
                    正在看：{artifact.title}
                    {shot ? ` / ${shot.title}` : ""}
                  </span>
                  <button
                    onClick={() => {
                      setSelected("");
                      setShotKey("");
                    }}
                    aria-label="清除对话定位"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              <div className="studio-composer">
                <Input.TextArea
                  aria-label="和导演对话"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    editable
                      ? "告诉美林要创作什么，或直接说哪里需要修改…"
                      : "你有查看权限，可请所有者开启编辑"
                  }
                  autoSize={{ minRows: 2, maxRows: 8 }}
                  maxLength={200000}
                  disabled={!editable || busy}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                <div className="composer-tools">
                  <Tooltip title="上传剧本或参考图">
                    <Button
                      type="text"
                      aria-label="上传剧本或参考图"
                      disabled={busy || !editable}
                      icon={<Paperclip size={18} />}
                      onClick={() => fileRef.current?.click()}
                    />
                  </Tooltip>
                  <Select
                    aria-label="对话模型"
                    variant="borderless"
                    size="small"
                    value={d.settings.textModel}
                    disabled={busy || Boolean(running) || !editable}
                    onChange={(id) => void act("model", { id })}
                    options={config?.models
                      .filter((m) => m.capability === "text")
                      .map((m) => ({ value: m.id, label: m.label }))}
                  />
                  <span className="composer-hint">Enter 发送</span>
                  <Button
                    type="primary"
                    className="send-message"
                    aria-label="发送给导演"
                    icon={<ArrowUp size={18} />}
                    loading={busy}
                    disabled={!text.trim() || Boolean(running) || !editable}
                    onClick={send}
                  />
                </div>
              </div>
              <p className="composer-footnote">
                图片与视频会先展示 Prompt 和报价，由你确认后再生成。
              </p>
            </div>
          </>
        )}
      </main>
      {d && workspace && (
        <aside className="artifact-workspace">
          <header className="workspace-heading">
            <h2>创作展现</h2>
            <div className="workspace-switch">
              <button
                className={view === "document" ? "active" : ""}
                onClick={() => setView("document")}
              >
                <FileText size={14} />
                文稿
              </button>
              <button
                className={view === "media" ? "active" : ""}
                onClick={() => setView("media")}
              >
                <ImageIcon size={14} />
                素材与成片
              </button>
            </div>
          </header>
          <div className="stage-strip" aria-label="制作进度">
            {(s?.mode === "audit"
              ? [{ id: "audit", name: "剧本体检" }]
              : c?.stages || []
            ).map((stage, i) => {
              const a = s?.artifacts.find((a) => a.kind === stage.id);
              return (
                <button
                  key={stage.id}
                  className={`${stage.id === s?.stage ? "current" : ""} ${a?.approved ? "done" : ""}`}
                  onClick={() =>
                    a
                      ? chooseArtifact(a.id)
                      : setText(`请说明${stage.name}需要先准备和确认什么。`)
                  }
                  title={stage.name}
                >
                  {a?.approved ? <Check size={12} /> : <span>{i + 1}</span>}
                  {stage.name}
                </button>
              );
            })}
          </div>
          {view === "media" ? (
            <div className="media-workspace">
              <h3>角色与场景</h3>
              <div className="real-assets">
                {d.assets.items.map((a) => {
                  const v = currentVersion(a);
                  return v?.url ? (
                    <figure key={a.code}>
                      <img src={v.url} alt={a.name} loading="lazy" />
                      <figcaption>
                        {a.name}
                        <small>
                          {a.code} · {a.versions.length} 版
                        </small>
                      </figcaption>
                      <Button
                        size="small"
                        onClick={() => {
                          uploadCode.current = a.code;
                          fileRef.current?.click();
                        }}
                        disabled={!editable || busy}
                      >
                        替换参考图
                      </Button>
                      <Select
                        size="small"
                        aria-label={`${a.name}图片版本`}
                        value={a.current}
                        disabled={!editable || busy}
                        options={a.versions.filter(v=>v.url).map((v,i)=>({value:v.id,label:`第${i+1}版`}))}
                        onChange={version=>void work(()=>api.action(d.id,'assets.pick',{code:a.code,version}))}
                      />
                    </figure>
                  ) : null;
                })}
              </div>
              {!d.assets.items.some((a) => currentVersion(a)?.url) && (
                <p className="empty-media">
                  确认资产提示词后，可以生成或上传图片。真实结果会显示在这里。
                </p>
              )}
              <h3>镜头视频与任务</h3>
              {d.production?.filter(p=>p.kind==='image'&&p.status!=='succeeded').map(p=><div className="image-job" key={p.id}><span>{p.label}</span><Tag>{STATUS[p.status]||p.status}</Tag>{p.error&&<p>{p.error}</p>}</div>)}
              {d.production
                ?.filter((p) => p.kind === "video")
                .map((p) => (
                  <figure className="video-result" key={p.id}>
                    <figcaption>
                      <b>{p.label}</b>
                      <Tag>{STATUS[p.status] || p.status}</Tag>
                    </figcaption>
                    {p.result?.url ? (
                      <video
                        src={p.result.url}
                        controls
                        preload="metadata"
                        playsInline
                      />
                    ) : (
                      <p>{p.error || "完成后会在这里播放。"}</p>
                    )}
                    <details>
                      <summary>查看这一版的实际 Prompt</summary>
                      <pre>{String(p.params?.prompt || "")}</pre>
                    </details>
                  </figure>
                ))}
              {!d.production?.some((p) => p.kind === "video") && (
                <p className="empty-media">
                  视频 Prompt 确认后，在镜头上点击“核对生成视频”。
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="artifact-tabs">
                {s?.artifacts.map((a) => (
                  <button
                    key={a.id}
                    className={a.id === artifact?.id ? "active" : ""}
                    onClick={() => chooseArtifact(a.id)}
                  >
                    <span>{a.title}</span>
                    {a.stale ? (
                      <Tag color="orange">需复核</Tag>
                    ) : a.approved === a.current ? (
                      <CheckCheck size={13} />
                    ) : (
                      <span className="draft-dot" title="草稿" />
                    )}
                  </button>
                ))}
              </div>
              {!artifact || !draft ? (
                <div className="empty-artifact">
                  <FileText size={32} />
                  <h3>你的故事，会在这里展开</h3>
                  <p>
                    先和美林聊聊想法。剧本、资产与分镜会逐步呈现；指出哪里要改，新版本就会更新到这里。
                  </p>
                  {s?.legacy && (
                    <p>历史项目文稿与媒体已保留，可以继续对话修改。</p>
                  )}
                </div>
              ) : (
                <>
                  <div className="document-toolbar">
                    <span>
                      {artifact.stale
                        ? "上游有变化，需复核"
                        : artifact.approved === draft.id
                          ? "已确认版本"
                          : "待确认草稿"}
                    </span>
                    <Select
                      aria-label="选择文稿版本"
                      size="small"
                      value={draft.id}
                      onChange={(id) => {
                        if (editing) {
                          message.info("请先保存编辑");
                          return;
                        }
                        setVersion(id);
                        setShotKey("");
                      }}
                      options={[...artifact.versions]
                        .reverse()
                        .map((v) => ({
                          value: v.id,
                          label: `v${v.n}${v.id === artifact.approved ? " · 已确认" : ""}`,
                        }))}
                    />
                    <Tooltip title="复制完整内容">
                      <Button
                        type="text"
                        size="small"
                        aria-label="复制内容"
                        icon={<Copy size={15} />}
                        onClick={() => void copy(shot?.prompt || draft.content)}
                      />
                    </Tooltip>
                    <Tooltip title="导出文稿">
                      <Button
                        type="text"
                        size="small"
                        aria-label="导出文稿"
                        icon={<Download size={15} />}
                        onClick={() =>
                          download(
                            `${artifact.title}-v${draft.n}.md`,
                            draft.content +
                              (draft.data.shots?.length
                                ? "\n\n" +
                                  draft.data.shots
                                    .map(
                                      (x) =>
                                        `# ${x.title} · ${x.seconds}秒\n\n${x.prompt}`,
                                    )
                                    .join("\n\n")
                                : ""),
                          )
                        }
                      />
                    </Tooltip>
                  </div>
                  <div className="artifact-surface">
                    <header className="document-title">
                      <h2>{artifact.title}</h2>
                      <span>
                        v{draft.n} · {shortDate(draft.at)}
                      </span>
                    </header>
                    {draft.data.shots?.length ? (
                      <>
                        <div className="shot-selector">
                          {draft.data.shots.map((x, i) => (
                            <button
                              key={x.key}
                              className={shot?.key === x.key ? "active" : ""}
                              onClick={() => {
                                if (editing) {
                                  message.info("请先保存编辑");
                                  return;
                                }
                                setShotKey(x.key);
                              }}
                            >
                              <span>镜头 {String(i + 1).padStart(2, "0")}</span>
                              <b>{x.title}</b>
                              <small>{x.seconds}s</small>
                            </button>
                          ))}
                        </div>
                        {shot && (
                          <>
                            <div className="shot-summary">
                              <h3>{shot.title}</h3>
                              <Tag>{shot.seconds}秒</Tag>
                              <Tag>{d.settings.aspect}</Tag>
                            </div>
                            <div className="bound-references">
                              {shot.referenceIds.map((id, i) => {
                                const a = (d.assets.items as any[]).find(
                                    (a) => a.id === id,
                                  ),
                                  v = a && currentVersion(a);
                                return (
                                  <Tooltip
                                    title={`${i + 1}. ${a?.name || "素材不存在"}`}
                                    key={id}
                                  >
                                    <span>
                                      {v?.url ? (
                                        <img src={v.url} alt={a.name} />
                                      ) : (
                                        <ImageIcon size={16} />
                                      )}
                                      <span>
                                        {i + 1}. {a?.name || "失效引用"}
                                      </span>
                                    </span>
                                  </Tooltip>
                                );
                              })}
                              {!shot.referenceIds.length && (
                                <small>
                                  尚未绑定参考图，可让导演按角色、场景自动匹配。
                                </small>
                              )}
                            </div>
                          </>
                        )}
                      </>
                    ) : null}
                    {editing ? (
                      <Input.TextArea
                        className="document-editor"
                        aria-label="编辑完整文稿"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        autoSize={{ minRows: 20 }}
                      />
                    ) : (
                      <pre className="document-text">
                        {shot?.prompt || draft.content}
                      </pre>
                    )}
                    {draft.data.assets && (
                      <div className="asset-plan">
                        {draft.data.assets.map((item) => {
                          const bound = (d.assets.items as any[]).find(
                              (a) =>
                                a.studioArtifact === artifact.id &&
                                a.studioKey === item.key,
                            ),
                            image = bound && currentVersion(bound);
                          return (
                            <section key={item.key}>
                              <div className="asset-plan-heading">
                                <span>
                                  {item.kind === "character"
                                    ? "角色"
                                    : item.kind === "scene"
                                      ? "场景"
                                      : "道具"}
                                </span>
                                <h3>{item.name}</h3>
                              </div>
                              {image?.url && (
                                <img src={image.url} alt={item.name} />
                              )}
                              <details>
                                <summary>完整出图 Prompt</summary>
                                <pre>{item.prompt}</pre>
                              </details>
                              <div className="asset-plan-actions">
                                <Button
                                  size="small"
                                  disabled={
                                    !editable ||
                                    artifact.approved !== draft.id ||
                                    artifact.stale ||
                                    busy
                                  }
                                  onClick={() =>
                                    startGenerate(
                                      artifact,
                                      item.key,
                                      "image",
                                      item.name,
                                    )
                                  }
                                >
                                  核对生成图片
                                </Button>
                                <Button
                                  size="small"
                                  disabled={!editable || !bound || busy}
                                  onClick={() => {
                                    uploadCode.current = bound.code;
                                    fileRef.current?.click();
                                  }}
                                >
                                  上传已有图片
                                </Button>
                              </div>
                            </section>
                          );
                        })}
                      </div>
                    )}
                    <details className="provenance">
                      <summary>
                        <History size={13} />
                        版本记录与方法来源
                      </summary>
                      <p>
                        {draft.note} ·{" "}
                        {new Date(draft.at).toLocaleString("zh-CN")}
                      </p>
                      <p>
                        方法文件 {draft.receipts?.length || 0}{" "}
                        份。文稿检查不等于已检查成片。
                      </p>
                      {draft.receipts?.map((r) => (
                        <small key={r.id + "/" + r.path}>
                          {r.id}/{r.path} · {r.sha256.slice(0, 12)}
                        </small>
                      ))}
                    </details>
                  </div>
                  <footer className="document-actions">
                    {editing ? (
                      <>
                        <Button
                          disabled={busy}
                          onClick={() => setEditing(false)}
                        >
                          取消编辑
                        </Button>
                        <Button
                          type="primary"
                          loading={busy}
                          onClick={() =>
                            void act(
                              "edit",
                              {
                                id: artifact.id,
                                version: draft.id,
                                content: editText,
                                shotKey: shot?.key,
                              },
                              () => {
                                setEditing(false);
                                setVersion("");
                              },
                            )
                          }
                        >
                          保存为新版本
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          disabled={
                            !editable ||
                            busy ||
                            Boolean(running) ||
                            draft.id !== artifact.current
                          }
                          onClick={() => {
                            setEditText(shot?.prompt || draft.content);
                            setVersion(draft.id);
                            setEditing(true);
                          }}
                        >
                          直接编辑
                        </Button>
                        <Button
                          disabled={
                            !editable ||
                            busy ||
                            artifact.approved === draft.id ||
                            draft.id !== artifact.current ||
                            Boolean(running)
                          }
                          onClick={() =>
                            void act("approve", {
                              id: artifact.id,
                              version: draft.id,
                            })
                          }
                          icon={<Check size={14} />}
                        >
                          确认这版
                        </Button>
                        {artifact.kind === "prompts" && shot ? (
                          <Button
                            type="primary"
                            disabled={
                              !editable ||
                              busy ||
                              artifact.approved !== draft.id ||
                              artifact.stale
                            }
                            onClick={() =>
                              startGenerate(
                                artifact,
                                shot.key,
                                "video",
                                shot.title,
                              )
                            }
                          >
                            核对生成视频
                          </Button>
                        ) : (
                          <Button
                            type="primary"
                            disabled={
                              !editable ||
                              busy ||
                              Boolean(running) ||
                              !artifact.approved ||
                              artifact.stale ||
                              s?.mode === "audit"
                            }
                            onClick={() => {
                              setSelected("");
                              void act("turn", {
                                text: `请继续当前制作阶段：${LABELS[s?.stage || "concept"]}。以上游已确认完整版本为依据；缺少前置选择先问我，不跳过确认。`,
                              });
                            }}
                          >
                            继续制作
                            <ChevronRight size={14} />
                          </Button>
                        )}
                      </>
                    )}
                  </footer>
                </>
              )}
            </>
          )}
        </aside>
      )}
      <input
        hidden
        ref={fileRef}
        type="file"
        accept=".txt,.md,.docx,.srt,.fountain,image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void uploadFile(f);
        }}
      />
      <Modal
        title="为这部作品选择一条链路"
        open={newOpen}
        onCancel={() => setNewOpen(false)}
        footer={
          <Button
            type="primary"
            disabled={!choice || busy}
            loading={busy}
            onClick={() => void create()}
          >
            用这条链路开始
            <ChevronRight size={15} />
          </Button>
        }
        width={720}
        className="chain-modal"
      >
        <p>每个项目只选一条。故事、镜头与 Prompt 之后都能通过对话继续调整。</p>
        <div className="chain-options">
          {config?.chains?.map((x, i) => (
            <button
              key={x.id}
              disabled={!x.available}
              className={choice === x.id ? "chosen" : ""}
              onClick={() => setChoice(x.id)}
            >
              <span className="chain-symbol">
                {i === 0 ? <Clapperboard /> : i === 1 ? <FileText /> : <Film />}
              </span>
              <span>
                <b>{x.name}</b>
                <strong>{x.lead}</strong>
                <p>{x.description}</p>
                {!x.available && (
                  <small>完整制作方法尚未安装，请联系管理员。</small>
                )}
              </span>
              <span className="chain-check">
                {choice === x.id && <Check size={18} />}
              </span>
            </button>
          ))}
        </div>
      </Modal>
      <Drawer
        title="模型与制作要求"
        open={settings}
        onClose={() => setSettings(false)}
        width={440}
      >
        <p>用于下一次文稿与媒体任务，已有生成结果保留。</p>
        {(["text", "image", "video"] as const).map((kind) => (
          <label className="setting-field" key={kind}>
            <span>
              {{ text: "对话模型", image: "图片模型", video: "视频模型" }[kind]}
            </span>
            <Select
              value={d?.settings[`${kind}Model`]}
              disabled={!editable || busy || Boolean(running)}
              options={config?.models
                .filter((m) => m.capability === kind)
                .map((m) => ({ value: m.id, label: m.label }))}
              onChange={(id) => void act("model", { id })}
            />
          </label>
        ))}
        <h3>作品约束</h3>
        <label className="setting-field">
          <span>确认总时长（秒）</span>
          <InputNumber
            min={5}
            max={7200}
            value={Number(s?.locks.seconds) || undefined}
            placeholder="按你的故事确定"
            disabled={!editable || busy}
            onChange={(n) => n && void act("locks", { seconds: n })}
          />
        </label>
        <label className="setting-field">
          <span>画幅比例</span>
          <Select
            value={s?.locks.ratio ? String(s.locks.ratio) : undefined}
            placeholder="选择比例"
            disabled={!editable || busy}
            options={config?.models
              .find((m) => m.id === d?.settings.videoModel)
              ?.cap.video?.ratios.map((value) => ({ value, label: value }))}
            onChange={(ratio) => void act("locks", { ratio })}
          />
        </label>
        {Object.entries(LOCKS).map(([key, entry]) => (
          <label className="setting-field" key={key}>
            <span>{entry.name}</span>
            <Select
              placeholder="可以在这里选择，也可以直接告诉导演"
              disabled={!editable || busy}
              value={s?.locks[key] ? String(s.locks[key]) : undefined}
              options={entry.values.map((value) => ({ value, label: value }))}
              onChange={(v) => void act("locks", { [key]: v })}
            />
          </label>
        ))}
        <p className="settings-note">
          已确认时长不会因模型限制自动缩短。更改上游要求后，相关文稿会提示复核。
        </p>
      </Drawer>
      <Modal
        title={`准备生成：${generate?.title || ""}`}
        open={Boolean(generate)}
        onCancel={() => setGenerate(undefined)}
        onOk={() =>
          generate &&
          void act("generate", { ...generate, params: genParams }, () => {
            setGenerate(undefined);
            setReview(true);
          })
        }
        okText="获取报价并核对完整内容"
        confirmLoading={busy}
      >
        <p>{liveModel?.label}</p>
        {generate?.kind === "image" ? (
          <>
            <label className="setting-field">
              <span>尺寸 / 比例</span>
              <Select
                value={String(genParams.size || "")}
                options={liveModel?.cap.image?.size.values.map((value) => ({
                  value,
                  label: value,
                }))}
                onChange={(size) => setGenParams((p) => ({ ...p, size }))}
              />
            </label>
            {liveModel?.cap.image?.quality.supported && (
              <label className="setting-field">
                <span>画质</span>
                <Select
                  value={String(genParams.quality || "")}
                  options={liveModel.cap.image.quality.values.map((value) => ({
                    value,
                    label: value,
                  }))}
                  onChange={(quality) =>
                    setGenParams((p) => ({ ...p, quality }))
                  }
                />
              </label>
            )}
          </>
        ) : (
          <>
            <label className="setting-field">
              <span>分辨率</span>
              <Select
                value={String(genParams.resolution || "")}
                options={liveModel?.cap.video?.resolutions.map((value) => ({
                  value,
                  label: value,
                }))}
                onChange={(resolution) =>
                  setGenParams((p) => ({ ...p, resolution }))
                }
              />
            </label>
            <label className="setting-field">
              <span>画幅</span>
              <Select
                value={String(genParams.ratio || "")}
                options={liveModel?.cap.video?.ratios.map((value) => ({
                  value,
                  label: value,
                }))}
                onChange={(ratio) => setGenParams((p) => ({ ...p, ratio }))}
              />
            </label>
            <p>秒数沿用已确认镜头；要改时长，先修改分镜与完整 Prompt。</p>
          </>
        )}
      </Modal>
      <Drawer
        title="核对生成任务"
        open={review}
        onClose={() => setReview(false)}
        width={640}
        footer={
          <div className="review-footer">
            <Button
              disabled={busy || !pending.length}
              onClick={() =>
                d &&
                void work(
                  () =>
                    api.cancel(
                      d.id,
                      pending.map((p) => p.id),
                    ),
                  () => setReview(false),
                )
              }
            >
              取消提交
            </Button>
            <Button
              disabled={busy || !pending.length}
              onClick={() =>
                d &&
                void work(() =>
                  api.requote(
                    d.id,
                    pending.map((p) => p.id),
                  ),
                )
              }
            >
              更新报价
            </Button>
            <Button
              type="primary"
              loading={busy}
              disabled={!pending.length}
              onClick={() =>
                d &&
                void work(
                  () => api.confirm(d.id, pending),
                  () => {
                    setReview(false);
                    setView("media");
                    setWorkspace(true);
                  },
                )
              }
            >
              确认费用并生成
            </Button>
          </div>
        }
      >
        <p>尚未提交图片或视频任务。确认后任务在后台继续，结果保存在本项目。</p>
        <p className="quote-total">
          {pending.length} 个任务 · {money(total)}
        </p>
        {pending.map((p) => (
          <section className="review-operation" key={p.id}>
            <h3>{p.label}</h3>
            <p>
              {config?.models.find((m) => m.id === p.model)?.label || p.model}
            </p>
            <div className="review-specs">
              {Object.entries(p.params || {})
                .filter(([k, v]) => k !== "prompt" && v !== undefined)
                .map(([k, v]) => (
                  <span key={k}>
                    {(
                      {
                        duration: "时长（秒）",
                        ratio: "比例",
                        resolution: "分辨率",
                        size: "图片尺寸",
                        quality: "画质",
                        generate_audio: "生成声音",
                        operation: "生成方式",
                      } as Record<string, string>
                    )[k] || k}
                    ：{String(v)}
                  </span>
                ))}
            </div>
            <div className="review-references">
              {p.referencePreviews?.map((r, i) => (
                <figure key={i}>
                  <img src={r.url} alt={r.name} />
                  <figcaption>
                    {i + 1}. {r.name}
                  </figcaption>
                </figure>
              ))}
            </div>
            <h4>实际完整 Prompt</h4>
            <pre className="review-prompt">
              {String(p.params?.prompt || "")}
            </pre>
            <p>{money(p.quote.estimatedCny)}</p>
            {p.quote.lines.map((line, i) => (
              <small key={i}>{line}</small>
            ))}
            <p>{p.quote.notes.join(" ")}</p>
            <small>
              剩余额度：
              {p.quote.budget.remainingCny === null
                ? "未设限额"
                : money(p.quote.budget.remainingCny)}{" "}
              · 报价有效期五分钟
            </small>
          </section>
        ))}
      </Drawer>
      <Modal
        title="项目成员协作"
        open={sharing}
        onCancel={() => setSharing(false)}
        footer={
          <Button
            type="primary"
            disabled={!d?.permissions?.owner || !memberEmail || busy}
            onClick={() =>
              d &&
              void work(
                async () => {
                  await api.share(d.id, { email: memberEmail, role: "editor" });
                  message.success("成员已加入，可继续协作");
                  return d;
                },
                () => setMemberEmail(""),
              )
            }
          >
            加入为编辑成员
          </Button>
        }
      >
        <p>
          所有者可邀请有效 FG 成员继续编辑；个人 Key 和制作额度按各自账号计算。
        </p>
        <Input
          aria-label="成员邮箱"
          value={memberEmail}
          onChange={(e) => setMemberEmail(e.target.value)}
          placeholder="同事的 FG 登录邮箱"
          disabled={!d?.permissions?.owner}
        />
      </Modal>
    </div>
  );
}
