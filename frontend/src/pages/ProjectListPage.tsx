import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { deleteProject, projectsQueryOptions, updateProject } from "@/api/projects";
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

type ProfessionalStatusFilter = "all" | ProfessionalDisplayStatus;

const professionalStatusOptions: Array<{ label: string; value: ProfessionalStatusFilter }> = [
  { label: "全部状态", value: "all" },
  { label: "待检测", value: "draft" },
  { label: "检测中", value: "detecting" },
  { label: "已完成", value: "completed" }
];

export function ProjectListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const projectsQuery = useQuery(projectsQueryOptions(user));
  const [searchKeyword, setSearchKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProfessionalStatusFilter>("all");

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
    user?.role === "admin" || project.created_by === user?.id
  );

  const visibleProjects = useMemo(() => {
    return [...(projectsQuery.data ?? [])]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [projectsQuery.data]);
  const workbenchProjects = useMemo(() => {
    const keyword = searchKeyword.trim().toLocaleLowerCase();
    return visibleProjects.map((project) => ({
      ...project,
      generated_at: project.created_at,
      title: project.name,
      professionalState: getProfessionalDisplayState(project),
      estimatedCompletionAt: getProfessionalEstimatedCompletionAt(project)
    })).filter((project) => {
      const matchesKeyword = !keyword
        || project.name.toLocaleLowerCase().includes(keyword)
        || project.project_no.toLocaleLowerCase().includes(keyword);
      const matchesStatus = statusFilter === "all"
        || project.professionalState.status === statusFilter;
      return matchesKeyword && matchesStatus;
    });
  }, [searchKeyword, statusFilter, visibleProjects]);
  const hasActiveFilters = Boolean(searchKeyword.trim()) || statusFilter !== "all";
  const showProjectEmptyState = !projectsQuery.isLoading && visibleProjects.length === 0;
  return <div className="report-list-page project-management-page"><div className="project-workspace">
    <div className="project-workbench-layout">
      <div className="project-workbench-content-panel">
        <header className={`list-page-heading${showProjectEmptyState ? " list-page-heading-empty-hidden" : ""}`}>
          <div className="list-page-heading-row">
            <h1>专业检测</h1>
          </div>
          <p>相比普通检测，提供更准确的检测结果，并增加可见光与热红外图像对照、立面朝向和拍摄高度等信息。</p>
          {visibleProjects.length ? <Link className="list-page-heading-action" to="/detections/new"><Plus aria-hidden="true" />开始检测</Link> : null}
        </header>
        {projectsQuery.isError ? <p className="project-list-error">项目列表加载失败，请稍后重试。</p> : null}
        {renameProjectMutation.isError || deleteProjectMutation.isError ? <p className="project-list-error" role="alert">操作失败，请稍后重试。</p> : null}
        <section
          className={`project-list-panel workbench-result-list-panel${visibleProjects.length ? " project-list-panel-with-controls" : ""}${showProjectEmptyState ? " project-list-empty-surface" : ""}`}
          aria-label="项目列表"
        >
          {visibleProjects.length ? <div className="project-list-controls" role="search">
            <div className="list-page-search-field">
              <Search aria-hidden="true" />
              <input
                aria-label="搜索检测项目"
                placeholder="输入检测名称"
                type="search"
                value={searchKeyword}
                onChange={(event) => setSearchKeyword(event.target.value)}
              />
            </div>
            <div className="project-list-status-filter">
              <select
                aria-label="按检测状态筛选"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as ProfessionalStatusFilter)}
              >
                {professionalStatusOptions.map((option) => <option key={option.value} value={option.value}>
                  {option.label}
                </option>)}
              </select>
              <ChevronDown aria-hidden="true" />
            </div>
          </div> : null}
          <div className="project-table-wrap project-workbench-table-wrap">
          {projectsQuery.isLoading ? <div className="project-empty"><strong>正在加载项目…</strong></div> : workbenchProjects.length ? <WorkbenchResultTable
            canDelete={(project) => canManageProject(project) && ["draft", "reviewed", "completed"].includes(project.status)}
            canRename={canManageProject}
            columnLabel="检测名称"
            completionTimeLabel="检测进度"
            getDeleteDisabledReason={(project) => canManageProject(project) ? "检测进行中，无法删除" : "仅项目所有者或管理员可以删除"}
            getActionLabel={(project) => project.professionalState.status === "completed" ? "查看结果" : "查看详情"}
            getKey={(project) => project.id}
            items={workbenchProjects}
            onDelete={handleDeleteProject}
            onOpen={(project) => navigate(
              project.professionalState.status === "completed" && project.current_report_id
                ? `/detections/results/${project.current_report_id}`
                : `/detections/${project.id}`
            )}
            onRename={handleRenameProject}
            renderCompletionTime={(project) => {
              if (project.professionalState.status === "draft") return "等待开始";
              if (project.professionalState.status === "completed") {
                return <time dateTime={project.completed_at ?? undefined}>
                  完成于 · {formatDateTime(project.completed_at).replace(/^\d{4}-/, "")}
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
          /> : visibleProjects.length && hasActiveFilters ? <div className="project-empty"><strong>未找到符合条件的检测项目</strong></div> : <ProjectEmptyState />}
        </div>
        </section>
      </div>
    </div>
  </div></div>;
}

function ProjectEmptyState() {
  return <div className="project-empty project-workbench-empty project-workbench-welcome-empty public-list-hero-empty">
    <span className="project-welcome-supporting-copy project-empty-hero-title">
      <span className="project-empty-hero-title-primary">上传照片</span>
      <span className="project-empty-hero-title-gradient">开始第一次专业检测</span>
    </span>
    <Link className="public-empty-cta-card" to="/detections/new">
      <span className="public-empty-card-copy">
        <strong>专业检测</strong>
        <span>相比普通检测，提供更准确的检测结果，并增加可见光与热红外图像对照、立面朝向和拍摄高度等信息。</span>
      </span>
      <span className="public-empty-card-action">
        开始检测<ChevronRight aria-hidden="true" />
      </span>
    </Link>
  </div>;
}
