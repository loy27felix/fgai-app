import { useCallback, useMemo, useState } from "react";
import { EmptyState, PageHeader } from "../components/Layout";
import { useApp } from "../AppContextValue";
import type { RouteName } from "../types";
import { ProjectCatalogNotice } from "./projects/ProjectCatalogNotice";
import "./projects.css";

type TrashListItem = {
  key: string;
  projectId: string;
  name: string;
  meta: string;
};

export function TrashPage({ navigate }: { navigate?: (route: RouteName) => void } = {}) {
  const [search, setSearch] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(() => new Set());
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [batchAction, setBatchAction] = useState<"restore" | null>(null);
  const {
    trashedProjects,
    restoreTrashedProject,
    projectCatalogError,
    projectCatalogRefreshing,
    refreshProjects,
  } = useApp();

  const localTrashItems = useMemo(
    () => trashedProjects.map((project) => ({
      key: project.project_id,
      projectId: project.project_id,
      name: project.name,
      meta: `已移入回收站 · ${new Date(project.updated_at).toLocaleDateString()}`,
    })),
    [trashedProjects],
  );

  const list = useMemo(() => localTrashItems.filter((item) => (
    item.name.toLowerCase().includes(search.toLowerCase())
  )), [localTrashItems, search]);

  const selectedProjects = useMemo(
    () => list.filter((item) => selectedProjectIds.has(item.projectId)),
    [list, selectedProjectIds],
  );
  const allVisibleSelected = list.length > 0 && list.every((item) => selectedProjectIds.has(item.projectId));
  const partiallySelected = selectedProjects.length > 0 && !allVisibleSelected;
  const selectionBusy = batchAction !== null;

  const clearSelectionForListChange = useCallback(() => {
    setSelectedProjectIds((current) => current.size > 0 ? new Set() : current);
    setSelectionError(null);
  }, []);

  const changeSearch = useCallback((value: string) => {
    if (value !== search) clearSelectionForListChange();
    setSearch(value);
  }, [clearSelectionForListChange, search]);

  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true);
    setSelectedProjectIds(new Set());
    setSelectionError(null);
  }, []);

  const exitSelectionMode = useCallback(() => {
    if (selectionBusy) return;
    setSelectionMode(false);
    setSelectedProjectIds(new Set());
    setSelectionError(null);
  }, [selectionBusy]);

  const toggleProjectSelection = useCallback((projectId: string) => {
    if (selectionBusy) return;
    setSelectedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, [selectionBusy]);

  const toggleVisibleSelection = useCallback(() => {
    if (selectionBusy) return;
    setSelectedProjectIds(allVisibleSelected
      ? new Set()
      : new Set(list.map((item) => item.projectId)));
  }, [allVisibleSelected, list, selectionBusy]);

  const runBatchRestore = useCallback(async () => {
    if (selectionBusy || selectedProjects.length === 0) return;

    const snapshot = [...selectedProjects];
    setBatchAction("restore");
    setSelectionError(null);
    const results = await Promise.allSettled(
      snapshot.map((item) => restoreTrashedProject(item.projectId)),
    );
    const failedProjectIds = new Set(
      snapshot
        .filter((_, index) => {
          const result = results[index];
          return result?.status === "rejected" || (result?.status === "fulfilled" && result.value !== true);
        })
        .map((item) => item.projectId),
    );

    setBatchAction(null);
    if (failedProjectIds.size > 0) {
      setSelectionError(`${failedProjectIds.size} ${failedProjectIds.size === 1 ? "project could not be" : "projects could not be"} restored.`);
      setSelectedProjectIds(failedProjectIds);
      return;
    }

    setSelectedProjectIds(new Set());
    setSelectionMode(false);
  }, [restoreTrashedProject, selectedProjects, selectionBusy]);

  return (
    <section className="content-wrap">
      <PageHeader title="回收站" subtitle="在这里恢复已移入回收站的广告工程。" />
      <div className="projects-toolbar">
        <div className="toolbar-row">
          <button className="filter-btn clear-glass-control is-active" type="button" onClick={() => navigate?.("projects")}>
            广告工程
          </button>
        </div>
        <div className="project-toolbar-actions">
          <input className="search-box clear-glass-control is-active" placeholder="搜索已删除工程" value={search} onChange={(event) => changeSearch(event.target.value)} />
          {!selectionMode ? (
            <button className="filter-btn clear-glass-control" type="button" onClick={enterSelectionMode}>
              选择
            </button>
          ) : (
            <>
              <button
                className={`filter-btn clear-glass-control project-selection-toggle${partiallySelected ? " is-partial" : ""}`}
                type="button"
                aria-pressed={allVisibleSelected}
                aria-label={partiallySelected ? "Select all deleted projects" : undefined}
                disabled={selectionBusy || list.length === 0}
                onClick={toggleVisibleSelection}
              >
                {allVisibleSelected ? "取消全选" : "全选"}
              </button>
              <button className="filter-btn clear-glass-control" type="button" disabled={selectionBusy} onClick={exitSelectionMode}>
                完成
              </button>
            </>
          )}
        </div>
      </div>
      {selectionMode ? (
        <div className="project-selection-toolbar" aria-busy={selectionBusy}>
          <div className="project-selection-summary">
            <strong>{`已选 ${selectedProjects.length} 个工程`}</strong>
            {selectionError ? <span className="project-selection-error" role="alert">{selectionError}</span> : null}
          </div>
          <div className="project-selection-actions">
            <button className="filter-btn clear-glass-control" type="button" disabled={selectionBusy || selectedProjects.length === 0} onClick={() => void runBatchRestore()}>
              {selectionBusy ? "恢复中…" : "恢复选中工程"}
            </button>
          </div>
        </div>
      ) : null}
      <ProjectCatalogNotice
        error={projectCatalogError}
        refreshing={projectCatalogRefreshing}
        onRetry={refreshProjects}
      />
      {list.length ? (
        <div className="trash-layout">
          {list.map((item) => (
            <article key={item.key} className={`trash-card${selectionMode ? " is-selection-mode" : ""}${selectedProjectIds.has(item.projectId) ? " is-selected" : ""}`} data-trash-card={item.name.toLowerCase()}>
              {selectionMode ? (
                <button
                  className="trash-card-select-area"
                  type="button"
                  aria-label={`${selectedProjectIds.has(item.projectId) ? "Deselect" : "Select"} ${item.name}`}
                  aria-pressed={selectedProjectIds.has(item.projectId)}
                  disabled={selectionBusy}
                  onClick={() => toggleProjectSelection(item.projectId)}
                >
                  <div className="trash-thumb" />
                  <div className="card-body">
                    <h3>{item.name}</h3>
                    <p>{item.meta}</p>
                  </div>
                </button>
              ) : (
                <>
                  <div className="trash-thumb" />
                  <div className="card-body">
                    <h3>{item.name}</h3>
                    <p>{item.meta}</p>
                  </div>
                </>
              )}
              {selectionMode ? (
                <input
                  className="trash-card-select"
                  type="checkbox"
                  checked={selectedProjectIds.has(item.projectId)}
                  disabled={selectionBusy}
                  aria-label={`Select ${item.name}`}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() => toggleProjectSelection(item.projectId)}
                />
              ) : (
                <div className="trash-actions">
                  <button
                    className="small-action"
                    title="恢复工程"
                    onClick={(event) => {
                      event.stopPropagation();
                      void restoreTrashedProject(item.projectId);
                    }}
                  >
                    恢复
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="回收站为空" />
      )}
    </section>
  );
}
