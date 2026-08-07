import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { projectsQueryOptions } from "@/api/projects";
import { ListPagination } from "@/components/ListPagination";
import { WorkbenchStatusBadge, type WorkbenchStatusVariant } from "@/components/WorkbenchStatusBadge";
import { WorkbenchDefectSummary, WorkbenchResultTable } from "@/components/WorkbenchResultTable";
import { useAuthStore } from "@/stores/useAuthStore";
import {
  getProfessionalDetectionProgress,
  type ProfessionalDisplayStatus
} from "@/utils/projectDisplay";

const projectStatusVariants: Record<ProfessionalDisplayStatus, WorkbenchStatusVariant> = {
  draft: "draft",
  queued: "queued",
  detecting: "detecting",
  generating: "generating",
  completed: "completed"
};

const PAGE_SIZE = 5;

export function ProjectListPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const projectsQuery = useQuery(projectsQueryOptions(user));
  const [searchKeyword, setSearchKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
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
      generated_at: project.created_at,
      title: project.name,
      professionalProgress: getProfessionalDetectionProgress(project, now)
    }));
  }, [matchingProjects, now]);
  const totalPages = Math.max(1, Math.ceil(workbenchProjects.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedProjects = workbenchProjects.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return <div className="report-list-page project-management-page"><div className="project-workspace">
    <div className="project-workbench-layout">
      <div className="project-workbench-content-panel">
        <header className="list-page-heading">
          <div className="list-page-heading-row">
            <h1>专业检测</h1>
            <Link className="list-page-heading-action" to="/projects/new"><Plus aria-hidden="true" />开始检测</Link>
          </div>
          <p>创建并管理专业外墙检测项目，上传照片后生成检测结果。</p>
        </header>
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
        </div> : null}
        {projectsQuery.isError ? <p className="project-list-error">项目列表加载失败，请稍后重试。</p> : null}
        <section className="project-list-panel workbench-result-list-panel" aria-label="项目列表"><div className="project-table-wrap project-workbench-table-wrap">
          {projectsQuery.isLoading ? <div className="project-empty"><strong>正在加载项目…</strong></div> : workbenchProjects.length ? <WorkbenchResultTable
            columnLabel="检测名称"
            getAriaLabel={(project) => `查看检测项目：${project.name}`}
            getKey={(project) => project.id}
            items={pagedProjects}
            onOpen={(project) => navigate(
              project.professionalProgress.status === "completed" && project.current_report_id
                ? `/reports/${project.current_report_id}`
                : `/projects/${project.id}`
            )}
            renderDetectionProgress={(project) => project.professionalProgress.progressLabel}
            renderDetectionDescription={(project) => <WorkbenchDefectSummary
              counts={project.by_defect_type}
              placeholder={project.professionalProgress.status === "completed" ? undefined : "--"}
            />}
            renderTitleAccessory={(project) => <WorkbenchStatusBadge
              className="project-name-status-icon"
              label={project.professionalProgress.statusLabel}
              variant={projectStatusVariants[project.professionalProgress.status]}
            />}
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

function ProjectEmptyState() {
  return <div className="project-empty project-workbench-empty project-workbench-welcome-empty">
    <span className="project-welcome-supporting-copy">暂无检测项目，创建项目后即可开始智能检测</span>
  </div>;
}
