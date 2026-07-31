import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, FolderKanban, Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";

import { deleteProject, projectsQueryOptions } from "@/api/projects";
import { ResultFolderThumbnail } from "@/components/ResultFolderThumbnail";
import type { ProjectStatus } from "@/types/projects";
import { formatDateTime, PROJECT_STATUS_LABELS } from "@/utils/projectDisplay";

const statusClass: Record<ProjectStatus, string> = {
  draft: "project-status-draft",
  detecting: "project-status-detecting",
  pending_review: "project-status-processing",
  reviewed: "project-status-generating",
  completed: "project-status-completed"
};

export function ProjectListPage() {
  const queryClient = useQueryClient();
  const projectsQuery = useQuery(projectsQueryOptions);
  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["projects"] })
  });
  const visibleProjects = useMemo(() => {
    return [...(projectsQuery.data ?? [])]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [projectsQuery.data]);
  const hasProjects = Boolean(projectsQuery.data?.length);

  function removeProject(project: { id: string; name: string }) {
    if (window.confirm(`确认删除项目“${project.name}”？此操作会软删除项目及其照片。`)) deleteMutation.mutate(project.id);
  }

  return <div className="report-list-page project-management-page"><div className="project-workspace">
    <section className="project-hero">
      <div className="management-page-title">
        <FolderKanban aria-hidden="true" className="management-page-title-icon" />
        <h1>检测工作台</h1>
      </div>
      {hasProjects ? <div className="project-hero-action"><Link className="button primary new-project-button project-external-new-project-button" to="/projects/new"><Plus aria-hidden="true" />新建项目</Link></div> : null}
    </section>
    <div className="project-workbench-content-panel">
      {projectsQuery.isError || deleteMutation.isError ? <p className="project-list-error">{projectsQuery.isError ? "项目列表加载失败，请稍后重试。" : "删除项目失败，请稍后重试。"}</p> : null}
      <section className="project-list-panel" aria-label="项目列表"><div className="project-table-wrap project-workbench-table-wrap">
        {projectsQuery.isLoading ? <div className="project-empty"><strong>正在加载项目…</strong></div> : visibleProjects.length ? <table className="project-table report-list-table project-workbench-table"><tbody>{visibleProjects.map((project) => <tr className="report-list-row" key={project.id}><td className="result-folder-column"><ResultFolderThumbnail firstPhotoUrl={project.first_photo_url} title={project.name} /></td><td className="report-name-column list-primary-column" data-label="项目名称"><span className="result-name-content"><strong className="project-name">{project.name}</strong><small className="result-generated-time">{formatDateTime(project.updated_at)}</small><span className={`project-mobile-status status-tag ${statusClass[project.status]}`}>{PROJECT_STATUS_LABELS[project.status]}</span></span><Link className="report-mobile-row-link" aria-label={`查看检测项目：${project.name}`} to={`/projects/${project.id}`} /></td><td className="project-status-column" data-label="当前状态"><span className={`status-tag ${statusClass[project.status]}`}>{PROJECT_STATUS_LABELS[project.status]}</span></td><td className="report-action-column list-action-column" data-label="操作"><div className="table-actions"><Link className="table-action" to={`/projects/${project.id}`}><Eye aria-hidden="true" />查看详情</Link>{project.status === "draft" ? <button className="table-action danger-table-action" disabled={deleteMutation.isPending} type="button" onClick={() => removeProject(project)}><Trash2 aria-hidden="true" />删除</button> : null}</div></td></tr>)}</tbody></table> : <ProjectEmptyState />}
      </div></section>
    </div>
  </div></div>;
}

function ProjectEmptyState() {
  return <div className="project-empty project-workbench-empty project-workbench-welcome-empty">
    <strong className="project-welcome-copy">欢迎使用外墙智能检测功能</strong>
    <span className="project-welcome-supporting-copy">当前没有检测项目，来新建一个吧</span>
    <Link className="button primary project-empty-create-button" to="/projects/new"><Plus aria-hidden="true" />新建项目</Link>
  </div>;
}
