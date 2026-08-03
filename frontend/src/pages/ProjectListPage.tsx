import { useQuery } from "@tanstack/react-query";
import { CircleCheckBig, CircleDashed, FolderKanban, Gauge, Images, Plus, RefreshCw, ScanSearch } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";

import { currentAccountUsageQueryOptions } from "@/api/accounts";
import { projectsQueryOptions } from "@/api/projects";
import { WorkbenchResultTable } from "@/components/WorkbenchResultTable";
import type { ProjectListItem, ProjectStatus } from "@/types/projects";
import { PROJECT_STATUS_LABELS } from "@/utils/projectDisplay";

const statusClass: Record<ProjectStatus, string> = {
  draft: "project-status-draft",
  detecting: "project-status-detecting",
  pending_review: "project-status-processing",
  reviewed: "project-status-generating",
  completed: "project-status-completed"
};

export function ProjectListPage() {
  const navigate = useNavigate();
  const projectsQuery = useQuery(projectsQueryOptions);
  const accountUsageQuery = useQuery(currentAccountUsageQueryOptions);
  const visibleProjects = useMemo(() => {
    return [...(projectsQuery.data ?? [])]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [projectsQuery.data]);
  const workbenchProjects = useMemo(() => {
    return visibleProjects.map((project) => ({
      ...project,
      generated_at: project.updated_at,
      title: project.name
    }));
  }, [visibleProjects]);

  return <div className="report-list-page project-management-page"><div className="project-workspace">
    <div className="project-workbench-layout">
      <ProjectWorkbenchSidebar
        isQuotaError={accountUsageQuery.isError}
        isQuotaLoading={accountUsageQuery.isLoading}
        onRetryQuota={() => void accountUsageQuery.refetch()}
        projects={visibleProjects}
        quota={accountUsageQuery.data?.trial_api_request_balance}
      />
      <div className="project-workbench-content-panel">
        {projectsQuery.isError ? <p className="project-list-error">项目列表加载失败，请稍后重试。</p> : null}
        <section className="project-list-panel" aria-label="项目列表"><div className="project-table-wrap project-workbench-table-wrap">
          {projectsQuery.isLoading ? <div className="project-empty"><strong>正在加载项目…</strong></div> : workbenchProjects.length ? <WorkbenchResultTable
            columnLabel="项目名称"
            getAriaLabel={(project) => `查看检测项目：${project.name}`}
            getKey={(project) => project.id}
            items={workbenchProjects}
            onOpen={(project) => navigate(`/projects/${project.id}`)}
            renderTitleAccessory={(project) => <ProjectStatusIcon className="project-name-status-icon" status={project.status} />}
          /> : <ProjectEmptyState />}
        </div></section>
      </div>
    </div>
  </div></div>;
}

function ProjectStatusIcon({ className = "", status }: { className?: string; status: ProjectStatus }) {
  const StatusIcon = status === "draft"
    ? CircleDashed
    : status === "completed"
      ? CircleCheckBig
      : ScanSearch;

  return <span
    aria-label={`当前状态：${PROJECT_STATUS_LABELS[status]}`}
    className={`project-row-status-icon ${statusClass[status]} ${className}`.trim()}
    role="img"
    title={PROJECT_STATUS_LABELS[status]}
  ><StatusIcon aria-hidden="true" /></span>;
}

function ProjectWorkbenchSidebar({
  isQuotaError,
  isQuotaLoading,
  onRetryQuota,
  projects,
  quota
}: {
  isQuotaError: boolean;
  isQuotaLoading: boolean;
  onRetryQuota: () => void;
  projects: ProjectListItem[];
  quota: { limit: number; remaining: number } | undefined;
}) {
  const counts = projects.reduce((result, project) => {
    if (project.status === "draft") result.pending += 1;
    else if (project.status === "completed") result.completed += 1;
    else result.detecting += 1;
    return result;
  }, { pending: 0, detecting: 0, completed: 0 });
  const completedPhotoCount = projects.reduce((total, project) => {
    return project.status === "completed" ? total + project.photo_count : total;
  }, 0);
  const quotaPercent = quota && quota.limit > 0
    ? Math.min(100, Math.max(0, quota.remaining / quota.limit * 100))
    : 0;

  return <aside className="project-workbench-sidebar" aria-label="检测工作台概览">
    <Link className="project-sidebar-new-project" to="/projects/new">
      <span className="project-sidebar-new-icon"><Plus aria-hidden="true" /></span>
      <span><strong>新建项目</strong><small>创建检测任务</small></span>
    </Link>

    <section className="project-sidebar-statistics" aria-labelledby="project-statistics-title">
      <h2 id="project-statistics-title"><FolderKanban aria-hidden="true" />项目统计</h2>
      <div className="project-sidebar-stats-grid">
        <article className="project-sidebar-stat project-sidebar-stat-pending">
          <CircleDashed aria-hidden="true" />
          <strong>{counts.pending}</strong>
          <span>未检测</span>
        </article>
        <article className="project-sidebar-stat project-sidebar-stat-detecting">
          <ScanSearch aria-hidden="true" />
          <strong>{counts.detecting}</strong>
          <span>检测中</span>
        </article>
        <article className="project-sidebar-stat project-sidebar-stat-completed">
          <CircleCheckBig aria-hidden="true" />
          <strong>{counts.completed}</strong>
          <span>已完成</span>
        </article>
      </div>
    </section>

    <section className="project-sidebar-completion-summary" aria-label="累计照片检测数量">
      <Images aria-hidden="true" />
      <div>
        <span>累计完成照片检测</span>
        <p><strong>{completedPhotoCount}</strong><small>张</small></p>
      </div>
    </section>

    <section className="project-sidebar-quota" aria-labelledby="project-quota-title">
      <div className="project-sidebar-card-heading">
        <span><Gauge aria-hidden="true" /><strong id="project-quota-title">检测额度</strong></span>
        <small>每日 00:00 重置</small>
      </div>
      {isQuotaError ? <div className="project-sidebar-quota-state" role="alert">
        <span>额度加载失败</span>
        <button type="button" onClick={onRetryQuota}><RefreshCw aria-hidden="true" />重试</button>
      </div> : isQuotaLoading || !quota ? <div className="project-sidebar-quota-loading" aria-label="正在加载检测额度"><span /><span /></div> : <>
        <div className="project-sidebar-quota-value"><strong>{quota.remaining}</strong><span>/ {quota.limit} 积分</span></div>
        <div
          aria-label={`检测额度余额 ${quota.remaining}，总额度 ${quota.limit}`}
          aria-valuemax={quota.limit}
          aria-valuemin={0}
          aria-valuenow={quota.remaining}
          className="project-sidebar-quota-track"
          role="progressbar"
        ><span style={{ width: `${quotaPercent}%` }} /></div>
        <small className="project-sidebar-quota-caption">剩余 {Math.round(quotaPercent)}%</small>
      </>}
    </section>
  </aside>;
}

function ProjectEmptyState() {
  return <div className="project-empty project-workbench-empty project-workbench-welcome-empty">
    <span className="project-welcome-supporting-copy">暂无检测项目，创建项目后即可开始智能检测</span>
    <Link className="button primary project-empty-create-button" to="/projects/new"><Plus aria-hidden="true" />新建项目</Link>
  </div>;
}
