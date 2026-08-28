import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { deleteProject, projectsQueryOptions, updateProject } from "@/api/projects";
import { ListPagination } from "@/components/ListPagination";
import { WorkbenchDefectSummary, WorkbenchResultTable } from "@/components/WorkbenchResultTable";
import { useAuthStore } from "@/stores/useAuthStore";
import type { ProjectListItem } from "@/types/projects";
import {
  formatDateTime,
  formatEstimatedRemainingTime,
  getProfessionalDisplayState,
  getProfessionalEstimatedCompletionAt,
  type ProfessionalDisplayStatus
} from "@/utils/projectDisplay";

const projectStatusClasses: Record<ProfessionalDisplayStatus, "detecting" | "ready" | "reviewed" | "neutral"> = {
  draft: "neutral",
  detecting: "detecting",
  completed: "ready"
};

const PAGE_SIZE = 10;

export function ProjectListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [currentPage, setCurrentPage] = useState(1);
  const [projectNameSearch, setProjectNameSearch] = useState("");
  const projectsQuery = useQuery(projectsQueryOptions(user));

  const renameProjectMutation = useMutation({
    mutationFn: ({ projectId, name }: { projectId: string; name: string }) => updateProject(projectId, { name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    }
  });
  const deleteProjectMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: async (_, projectId) => {
      queryClient.removeQueries({ queryKey: ["projects", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    }
  });

  const handleRenameProject = (project: ProjectListItem) => {
    const nextName = window.prompt("请输入新的检测名称", project.name);
    if (nextName === null) return;
    const name = nextName.trim();
    if (!name) {
      window.alert("检测名称不能为空。");
      return;
    }
    if (name === project.name) return;
    renameProjectMutation.mutate({ projectId: project.id, name });
  };

  const handleDeleteProject = (project: ProjectListItem) => {
    if (!["draft", "reviewed", "completed"].includes(project.status)) return;
    if (!window.confirm(`确认删除检测“${project.name}”？删除后将无法恢复。`)) return;
    deleteProjectMutation.mutate(project.id);
  };

  const canManageProject = (project: ProjectListItem) => (
    !project.is_example && (user?.role === "admin" || project.created_by === user?.id)
  );

  const visibleProjects = useMemo(() => {
    return [...(projectsQuery.data ?? [])]
      .sort((a, b) => Number(b.is_example) - Number(a.is_example) || b.updated_at.localeCompare(a.updated_at));
  }, [projectsQuery.data]);
  const matchingProjects = useMemo(() => {
    const search = projectNameSearch.trim().toLocaleLowerCase();
    if (!search) return visibleProjects;
    return visibleProjects.filter((project) => project.name.toLocaleLowerCase().includes(search));
  }, [projectNameSearch, visibleProjects]);
  const workbenchProjects = useMemo(() => {
    return matchingProjects.map((project) => ({
      ...project,
      generated_at: project.created_at,
      title: project.name,
      professionalState: getProfessionalDisplayState(project),
      estimatedCompletionAt: getProfessionalEstimatedCompletionAt(project)
    }));
  }, [matchingProjects]);
  const totalPages = Math.max(1, Math.ceil(workbenchProjects.length / PAGE_SIZE));
  const visiblePage = Math.min(currentPage, totalPages);
  const paginatedProjects = useMemo(() => {
    const startIndex = (visiblePage - 1) * PAGE_SIZE;
    return workbenchProjects.slice(startIndex, startIndex + PAGE_SIZE);
  }, [visiblePage, workbenchProjects]);
  return <div className="report-list-page project-management-page"><div className="project-workspace">
    <div className="project-workbench-layout">
      <div className="project-workbench-content-panel">
        {projectsQuery.isError ? <p className="project-list-error">项目列表加载失败，请稍后重试。</p> : null}
        {renameProjectMutation.isError || deleteProjectMutation.isError ? <p className="project-list-error" role="alert">操作失败，请稍后重试。</p> : null}
        <section
          className="project-list-panel workbench-result-list-panel"
          aria-label="项目列表"
        >
          {visibleProjects.length ? <div className="project-name-search-toolbar">
            <label className="project-name-search-field floating-line-field">
              <input
                aria-label="搜索检测项目"
                autoComplete="off"
                placeholder=" "
                type="search"
                value={projectNameSearch}
                onChange={(event) => {
                  setProjectNameSearch(event.target.value);
                  setCurrentPage(1);
                }}
              />
              <span>搜索检测项目</span>
            </label>
          </div> : null}
          <div className="project-table-wrap project-workbench-table-wrap">
          {projectsQuery.isLoading ? <div className="project-empty"><strong>正在加载项目…</strong></div> : visibleProjects.length && workbenchProjects.length ? <WorkbenchResultTable
            canDelete={(project) => canManageProject(project) && ["draft", "reviewed", "completed"].includes(project.status)}
            canRename={(project) => canManageProject(project) && project.status === "draft"}
            columnLabel="检测名称"
            completionTimeLabel="完成时间"
            getDeleteDisabledReason={(project) => project.is_example
              ? "示例项目为所有账号共享，无法删除"
              : canManageProject(project) ? "检测进行中，无法删除" : "仅项目所有者或管理员可以删除"}
            getLeadingActionLabel={() => "3D模型"}
            getKey={(project) => project.id}
            items={paginatedProjects}
            onDelete={handleDeleteProject}
            onLeadingAction={(project) => navigate(`/detections/${project.id}/model`, {
              state: { projectTitle: project.title }
            })}
            onOpen={(project) => navigate(`/detections/${project.id}`)}
            openOnRowClick
            onRename={handleRenameProject}
            renderCompletionTime={(project) => {
              if (project.professionalState.status === "draft") return "--";
              if (project.professionalState.status === "completed") {
                if (!project.completed_at) return "--";
                return <time dateTime={project.completed_at ?? undefined}>
                  {formatDateTime(project.completed_at)}
                </time>;
              }
              return <time dateTime={project.estimatedCompletionAt ?? undefined}>
                {formatEstimatedRemainingTime(project.estimatedCompletionAt)}
              </time>;
            }}
            renderDetectionDescription={(project) => <WorkbenchDefectSummary
              counts={project.by_defect_type}
              placeholder={project.professionalState.status === "completed" ? undefined : "--"}
              variant="compact"
            />}
            renderTitleAccessory={(project) => <span
              aria-label={`当前状态：${project.professionalState.statusLabel}`}
              className={`status-tag ${projectStatusClasses[project.professionalState.status]}`}
              title={project.professionalState.statusLabel}
            >
              {project.professionalState.statusLabel}
            </span>}
            titleAccessoryLabel="检测进度"
          /> : visibleProjects.length ? <div className="project-empty project-search-empty-state">
            <strong>未找到匹配的检测项目</strong>
            <span>请尝试其他项目名称。</span>
          </div> : null}
        </div>
        <ListPagination
          currentPage={visiblePage}
          onPageChange={setCurrentPage}
          pageSize={PAGE_SIZE}
          totalItems={workbenchProjects.length}
        />
        </section>
        <p className="list-page-switch-prompt">
          提示：想要快速体验检测流程？可前往<Link to="/trials">快速体验页面</Link>。
        </p>
      </div>
    </div>
  </div></div>;
}
