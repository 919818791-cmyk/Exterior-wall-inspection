import { useQuery } from "@tanstack/react-query";
import { CircleCheckBig, CircleDashed, Plus, ScanSearch } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { projectsQueryOptions } from "@/api/projects";
import { ListPagination } from "@/components/ListPagination";
import { WorkbenchDefectSummary, WorkbenchResultTable } from "@/components/WorkbenchResultTable";
import type { ProjectStatus } from "@/types/projects";
import { PROJECT_STATUS_LABELS } from "@/utils/projectDisplay";

const statusClass: Record<ProjectStatus, string> = {
  draft: "project-status-draft",
  detecting: "project-status-detecting",
  pending_review: "project-status-processing",
  reviewed: "project-status-completed",
  completed: "project-status-completed"
};

const PAGE_SIZE = 6;

export function ProjectListPage() {
  const navigate = useNavigate();
  const projectsQuery = useQuery(projectsQueryOptions);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [page, setPage] = useState(1);
  const visibleProjects = useMemo(() => {
    return [...(projectsQuery.data ?? [])]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [projectsQuery.data]);
  const matchingProjects = useMemo(() => {
    const keyword = searchKeyword.trim().toLocaleLowerCase();
    if (!keyword) return visibleProjects;
    return visibleProjects.filter((project) => (
      project.name.toLocaleLowerCase().includes(keyword)
      || project.project_no.toLocaleLowerCase().includes(keyword)
    ));
  }, [searchKeyword, visibleProjects]);
  const workbenchProjects = useMemo(() => {
    return matchingProjects.map((project) => ({
      ...project,
      generated_at: project.updated_at,
      title: project.name
    }));
  }, [matchingProjects]);
  const totalPages = Math.max(1, Math.ceil(workbenchProjects.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedProjects = workbenchProjects.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return <div className="report-list-page project-management-page"><div className="project-workspace">
    <div className="project-workbench-layout">
      <div className="project-workbench-content-panel">
        {visibleProjects.length ? <div
          className="project-list-search-toolbar"
          role="search"
        >
          <input
            aria-label="搜索检测项目"
            placeholder="输入检测名称"
            type="search"
            value={searchKeyword}
            onChange={(event) => {
              setSearchKeyword(event.target.value);
              setPage(1);
            }}
          />
          <Link className="project-list-create-button" to="/projects/new"><Plus aria-hidden="true" />新建检测</Link>
        </div> : null}
        {projectsQuery.isError ? <p className="project-list-error">项目列表加载失败，请稍后重试。</p> : null}
        <section className="project-list-panel workbench-result-list-panel" aria-label="项目列表"><div className="project-table-wrap project-workbench-table-wrap">
          {projectsQuery.isLoading ? <div className="project-empty"><strong>正在加载项目…</strong></div> : workbenchProjects.length ? <WorkbenchResultTable
            columnLabel="检测名称"
            getAriaLabel={(project) => `查看检测项目：${project.name}`}
            getKey={(project) => project.id}
            items={pagedProjects}
            onOpen={(project) => navigate(
              (project.status === "reviewed" || project.status === "completed") && project.current_report_id
                ? `/reports/${project.current_report_id}`
                : `/projects/${project.id}`
            )}
            renderDetectionDescription={(project) => <WorkbenchDefectSummary counts={project.by_defect_type} />}
            renderTitleAccessory={(project) => <ProjectStatusIcon className="project-name-status-icon" status={project.status} />}
          /> : visibleProjects.length && searchKeyword.trim() ? <div className="project-empty"><strong>未找到匹配的检测项目</strong></div> : <ProjectEmptyState />}
        </div>
        {workbenchProjects.length ? <ListPagination
          currentPage={currentPage}
          onPageChange={setPage}
          pageSize={PAGE_SIZE}
          totalItems={workbenchProjects.length}
        /> : null}
        </section>
      </div>
    </div>
  </div></div>;
}

function ProjectStatusIcon({ className = "", status }: { className?: string; status: ProjectStatus }) {
  const StatusIcon = status === "draft"
    ? CircleDashed
    : status === "reviewed" || status === "completed"
      ? CircleCheckBig
      : ScanSearch;

  return <span
    aria-label={`当前状态：${PROJECT_STATUS_LABELS[status]}`}
    className={`project-row-status-icon ${statusClass[status]} ${className}`.trim()}
    title={PROJECT_STATUS_LABELS[status]}
  >
    <StatusIcon aria-hidden="true" />
    <span className="project-status-label">{PROJECT_STATUS_LABELS[status]}</span>
  </span>;
}

function ProjectEmptyState() {
  return <div className="project-empty project-workbench-empty project-workbench-welcome-empty">
    <span className="project-welcome-supporting-copy">暂无检测项目，创建项目后即可开始智能检测</span>
    <Link className="button primary project-empty-create-button" to="/projects/new"><Plus aria-hidden="true" />开始检测</Link>
  </div>;
}
