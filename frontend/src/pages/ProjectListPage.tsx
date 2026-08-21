import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";

import { deleteProject, projectsQueryOptions, updateProject } from "@/api/projects";
import { WorkbenchDefectSummary, WorkbenchResultTable } from "@/components/WorkbenchResultTable";
import { WorkbenchStatusBadge, type WorkbenchStatusVariant } from "@/components/WorkbenchStatusBadge";
import { useAuthStore } from "@/stores/useAuthStore";
import type { ProjectListItem } from "@/types/projects";
import {
  formatDateTime,
  formatEstimatedRemainingTime,
  getProfessionalDisplayState,
  getProfessionalEstimatedCompletionAt,
  type ProfessionalDisplayStatus
} from "@/utils/projectDisplay";

const projectStatusVariants: Record<ProfessionalDisplayStatus, WorkbenchStatusVariant> = {
  draft: "draft",
  detecting: "detecting",
  completed: "completed"
};

export function ProjectListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
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
    user?.role === "admin" || project.created_by === user?.id
  );

  const visibleProjects = useMemo(() => {
    return [...(projectsQuery.data ?? [])]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [projectsQuery.data]);
  const workbenchProjects = useMemo(() => {
    return visibleProjects.map((project) => ({
      ...project,
      generated_at: project.created_at,
      title: project.name,
      professionalState: getProfessionalDisplayState(project),
      estimatedCompletionAt: getProfessionalEstimatedCompletionAt(project)
    }));
  }, [visibleProjects]);
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
          className={`project-list-panel workbench-result-list-panel${showProjectEmptyState ? " project-list-empty-surface" : ""}`}
          aria-label="项目列表"
        >
          <div className="project-table-wrap project-workbench-table-wrap">
          {projectsQuery.isLoading ? <div className="project-empty"><strong>正在加载项目…</strong></div> : workbenchProjects.length ? <WorkbenchResultTable
            canDelete={(project) => canManageProject(project) && ["draft", "reviewed", "completed"].includes(project.status)}
            canRename={canManageProject}
            columnLabel="检测名称"
            completionTimeLabel="完成时间"
            getDeleteDisabledReason={(project) => canManageProject(project) ? "检测进行中，无法删除" : "仅项目所有者或管理员可以删除"}
            getLeadingActionLabel={() => "3D模型"}
            getKey={(project) => project.id}
            items={workbenchProjects}
            onDelete={handleDeleteProject}
            onLeadingAction={(project) => navigate(`/detections/${project.id}/model`, {
              state: { projectTitle: project.title }
            })}
            onOpen={(project) => navigate(
              project.professionalState.status === "completed" && project.current_report_id
                ? `/detections/results/${project.current_report_id}`
                : `/detections/${project.id}`
            )}
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
            renderTitleAccessory={(project) => <WorkbenchStatusBadge
              className="project-name-status-icon"
              label={project.professionalState.statusLabel}
              variant={projectStatusVariants[project.professionalState.status]}
            />}
            titleAccessoryLabel="检测进度"
          /> : <ProjectEmptyState />}
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
        <strong>开始检测<ChevronRight aria-hidden="true" /></strong>
        <span>提供更准确的检测结果，并增加可见光与热红外图像对照、立面朝向和拍摄高度等信息。</span>
      </span>
    </Link>
  </div>;
}
