import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsPage } from "./ProjectsPage.tsx";

const fixture = vi.hoisted(() => ({
  openProject: vi.fn(),
  moveProjectToTrash: vi.fn(),
  toggleProjectFavorite: vi.fn(),
  renameProject: vi.fn(),
  startNewProject: vi.fn(),
  refreshProjects: vi.fn(),
  listAgentCanvasProjectAssets: vi.fn(),
  savedProjects: [
    {
      project_id: "project-1",
      workflow_id: "workflow-1",
      name: "Summer launch",
      is_favorite: false,
      updated_at: "2026-07-24T08:00:00Z",
      cover_asset_id: null,
    },
    {
      project_id: "project-2",
      workflow_id: "workflow-2",
      name: "Winter launch",
      is_favorite: true,
      updated_at: "2026-07-25T08:00:00Z",
      cover_asset_id: null,
    },
  ],
}));

vi.mock("../AppContextValue", () => ({
  useApp: () => ({
    savedProjects: fixture.savedProjects,
    startNewProject: fixture.startNewProject,
    openProject: fixture.openProject,
    moveProjectToTrash: fixture.moveProjectToTrash,
    renameProject: fixture.renameProject,
    toggleProjectFavorite: fixture.toggleProjectFavorite,
    projectCatalogError: null,
    projectCatalogRefreshing: false,
    refreshProjects: fixture.refreshProjects,
  }),
}));

vi.mock("../api/agentCanvasApi.ts", () => ({
  agentCanvasApi: {
    listAgentCanvasProjectAssets: fixture.listAgentCanvasProjectAssets,
  },
}));

function renderPage() {
  return render(<ProjectsPage navigate={vi.fn()} />);
}

describe("ProjectsPage batch selection", () => {
  beforeEach(() => {
    fixture.openProject.mockResolvedValue(true);
    fixture.moveProjectToTrash.mockResolvedValue(true);
    fixture.toggleProjectFavorite.mockResolvedValue(true);
    fixture.refreshProjects.mockResolvedValue(true);
    fixture.listAgentCanvasProjectAssets.mockResolvedValue({ assets: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("enters selection mode without making New Project selectable", () => {
    const view = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    expect(screen.getByRole("button", { name: "全选" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "完成" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Select New Project" })).toBeNull();

    fireEvent.click(view.container.querySelector('[data-project-id="project-1"] .project-card-open') as HTMLElement);

    expect(fixture.openProject).not.toHaveBeenCalled();
    expect(screen.getByText("已选 1 个工程")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Select Summer launch" }) as HTMLInputElement).checked).toBe(true);
  });

  it("selects only the current filtered results and clears selection when the list changes", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    expect(screen.getByText("已选 2 个工程")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("搜索工程"), { target: { value: "Summer" } });

    expect(screen.getByText("工程列表已更新，已清除选中项。")).toBeTruthy();
    expect(screen.queryByText("已选 2 个工程")).toBeNull();
    expect((screen.getByRole("checkbox", { name: "Select Summer launch" }) as HTMLInputElement).checked).toBe(false);
  });

  it("shows a partial select-all state before completing the visible selection", () => {
    const view = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.click(view.container.querySelector('[data-project-id="project-1"] .project-card-open') as HTMLElement);

    const selectAll = screen.getByRole("button", { name: "Select all projects" });
    expect(selectAll.classList.contains("is-partial")).toBe(true);
    expect(selectAll.textContent).toBe("全选");
  });

  it("runs the existing favorite operation for every selected project", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    fireEvent.click(screen.getByRole("button", { name: "收藏选中" }));

    await waitFor(() => expect(fixture.toggleProjectFavorite).toHaveBeenCalledTimes(2));
    expect(fixture.toggleProjectFavorite).toHaveBeenNthCalledWith(1, fixture.savedProjects[0]);
    expect(fixture.toggleProjectFavorite).toHaveBeenNthCalledWith(2, fixture.savedProjects[1]);
    expect(screen.getByRole("button", { name: "选择" })).toBeTruthy();
  });

  it("keeps failed projects selected after a partial trash operation", async () => {
    fixture.moveProjectToTrash
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("Trash request failed"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    fireEvent.click(screen.getByRole("button", { name: "移入回收站" }));

    await waitFor(() => expect(fixture.moveProjectToTrash).toHaveBeenCalledTimes(2));
    expect(screen.getByText("1 project could not be moved to trash.")).toBeTruthy();
    expect(screen.getByText("已选 1 个工程")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Select Winter launch" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Select Summer launch" }) as HTMLInputElement).checked).toBe(false);
  });
});
