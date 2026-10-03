import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";
import type { RouteName } from "../types";
import { AssetsIcon, FolderIcon, HomeIcon, TrashIcon, TutorialIcon } from "../icons";
import { useHealth } from "../app/useHealth";
import {
  v2AuthoringConflictStore,
  type V2AuthoringConflict,
} from "../api/v2AuthoringConflictStore";
import {
  V2_AUTHORING_CONFLICT_RESOLVED_EVENT,
  type V2AuthoringConflictResolution,
} from "../api/v2AuthoringConflictEvents.ts";

const navItems: Array<{ route: Exclude<RouteName, "api-space">; label: string; icon: ReactNode }> = [
  { route: "home", label: "创意", icon: <HomeIcon /> },
  { route: "projects", label: "工程", icon: <FolderIcon /> },
  { route: "assets", label: "素材", icon: <AssetsIcon /> },
  { route: "trash", label: "回收站", icon: <TrashIcon /> },
];

interface LayoutProps {
  children: ReactNode;
  workflowControls?: ReactNode;
}

export function Layout({ children, workflowControls }: LayoutProps) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [authoringConflict, setAuthoringConflict] = useState<V2AuthoringConflict | null>(() => v2AuthoringConflictStore.current());
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const { apiOnline, apiMessage, apiConfig, storageWarning } = useHealth();
  const location = useLocation();
  const navigate = useNavigate();
  const isWorkflowRoute = useMatch("/workflow/*") !== null;
  const usesClearGlassRail = ["/", "/projects", "/assets", "/trash"].includes(location.pathname)
    || location.pathname.startsWith("/workflow");

  const configReady = apiConfig !== null && apiConfig.coreMissing.length === 0;
  const badgeState = apiOnline === false
    ? "offline"
    : apiOnline === null
      ? "checking"
      : apiConfig === null
        ? "online"
        : configReady
          ? "online"
          : apiConfig.configured.length > 0
            ? "partial"
            : "unconfigured";
  const badgeLabel = badgeState === "offline"
    ? "Demo mode"
    : badgeState === "checking"
      ? "Checking"
      : badgeState === "online"
        ? "制作服务已连接"
        : badgeState === "partial"
          ? `API config ${apiConfig?.configured.length ?? 0}/${(apiConfig?.configured.length ?? 0) + (apiConfig?.coreMissing.length ?? 0)}`
          : "API not configured";
  const badgeTitle = apiOnline === false || apiConfig === null
    ? apiMessage
    : [
        apiMessage,
        `已配置能力: ${apiConfig.configured.join(", ") || "无"}`,
        apiConfig.coreMissing.length ? `缺少: ${apiConfig.coreMissing.join(", ")}` : null,
      ].filter(Boolean).join("\n");

  useEffect(() => v2AuthoringConflictStore.subscribe(setAuthoringConflict), []);

  async function resolveConflict(action: "retry" | "discard") {
    if (!authoringConflict) return;
    setResolvingConflict(true);
    try {
      await v2AuthoringConflictStore[action]();
      const resolution: V2AuthoringConflictResolution = {
        target: authoringConflict.target,
        operationPath: authoringConflict.operationPath,
        action,
      };
      window.dispatchEvent(new CustomEvent(V2_AUTHORING_CONFLICT_RESOLVED_EVENT, {
        detail: resolution,
      }));
    } finally {
      setResolvingConflict(false);
    }
  }

  function closeAccountMenu() {
    setAccountOpen(false);
  }

  function signOutDemo() {
    setAccountOpen(false);
    navigate("/");
  }

  return (
    <>
      <nav className={`floating-rail${usesClearGlassRail ? " floating-rail--clear-glass" : ""}`} aria-label="Primary navigation">
        {navItems.map((item) => (
          <NavLink
            key={item.route}
            className={({ isActive }) => `rail-item${usesClearGlassRail ? " clear-glass-control" : ""} ${isActive ? "is-active" : ""}`}
            to={routePath(item.route)}
            aria-label={item.label}
            end={item.route === "home"}
          >
            <span className="rail-icon">{item.icon}</span>
            <span className="tooltip">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div
        className={`app-shell${isWorkflowRoute ? " app-shell--workflow" : " app-shell--cosmic"}`}
        id="app"
      >
        <header className="topbar">
          <Link className="brand" to="/" aria-label="FG 广告工作台" onClick={closeAccountMenu}>
            <div className="brand-picture">
              <strong className="brand-logo" style={{ fontSize: 20, letterSpacing: 2 }}>FG</strong>
            </div>
          </Link>
          <div className={`api-chip ${badgeState === "online" ? "is-online" : badgeState === "offline" || badgeState === "unconfigured" ? "is-offline" : badgeState === "partial" ? "is-partial" : ""}`} title={badgeTitle}>
            {badgeLabel}
          </div>
          {storageWarning ? (
            <div className="storage-warning" role="alert" title={storageWarning}>
              {storageWarning}
            </div>
          ) : null}
          {authoringConflict ? (
            <div className="authoring-conflict" role="alert">
              <span>{authoringConflict.message} Keep the local draft, then retry or discard it.</span>
              <button type="button" disabled={resolvingConflict} onClick={() => void resolveConflict("retry")}>Retry</button>
              <button type="button" disabled={resolvingConflict} onClick={() => void resolveConflict("discard")}>Discard</button>
            </div>
          ) : null}
          <div className="top-actions">
            {workflowControls}
            <Link className="ghost-btn" to="/?guide=1" onClick={closeAccountMenu}>
              <TutorialIcon />
              <span>使用指南</span>
            </Link>
            <button
              className="avatar-btn"
              aria-label="Account menu"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((value) => !value)}
            >
              FG
            </button>
            <div className={`account-menu ${accountOpen ? "is-open" : ""}`}>
              <Link to="/projects" onClick={closeAccountMenu}>项目工程</Link>
              <Link to="/assets" onClick={closeAccountMenu}>项目素材</Link>
              <span>公司模型渠道 · WeToken</span>
              <button type="button" onClick={signOutDemo}>返回创意首页</button>
            </div>
          </div>
        </header>

        <main className="main-view" id="view" aria-live="polite" data-route={location.pathname}>
          {children}
        </main>
      </div>
    </>
  );
}

export function LayoutRoute() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="page-header">
      <h1 className="page-title">{title}</h1>
      <p className="page-subtitle">{subtitle}</p>
    </header>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <div>
        <div className="mascot" />
        <h3>{text}</h3>
      </div>
    </div>
  );
}

function routePath(route: Exclude<RouteName, "api-space">) {
  if (route === "home") return "/";
  return `/${route}`;
}
