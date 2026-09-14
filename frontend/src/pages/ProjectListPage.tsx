import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { projectsQueryOptions } from "@/api/projects";
import { ListPagination } from "@/components/ListPagination";
import { WorkbenchNameSearch } from "@/components/WorkbenchNameSearch";
import { WorkbenchDefectSummary, WorkbenchResultTable } from "@/components/WorkbenchResultTable";
import { useAuthStore } from "@/stores/useAuthStore";
import {
  formatDateTime,
  formatEstimatedRemainingTime,
  getProfessionalDisplayState,
  getProfessionalEstimatedCompletionAt
} from "@/utils/projectDisplay";

const PAGE_SIZE = 10;

export function ProjectListPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [currentPage, setCurrentPage] = useState(1);
  const [projectNameSearch, setProjectNameSearch] = useState("");
  const projectsQuery = useQuery(projectsQueryOptions(user));

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
        <section
          className="project-list-panel workbench-result-list-panel"
          aria-label="项目列表"
        >
          {visibleProjects.length ? <WorkbenchNameSearch
            value={projectNameSearch}
            onChange={(value) => {
              setProjectNameSearch(value);
              setCurrentPage(1);
            }}
          /> : null}
          <div className="project-table-wrap project-workbench-table-wrap">
          {projectsQuery.isLoading ? <div className="project-empty"><strong>正在加载项目…</strong></div> : visibleProjects.length && workbenchProjects.length ? <WorkbenchResultTable
            columnLabel="检测名称"
            completionTimeLabel="完成时间"
            getKey={(project) => project.id}
            items={paginatedProjects}
            onOpen={(project) => navigate(`/detections/${project.id}`)}
            openOnRowClick
            renderCompletionTime={(project) => {
              if (project.professionalState.status === "draft") return "未开始检测";
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
            renderTrailingIndicator={(project) => project.generate_building_model ? (
              <img alt="" aria-hidden="true" src="/icons/action-cube.png" />
            ) : null}
            renderTitleAccessory={(project) => (
              <time dateTime={project.created_at}>{formatDateTime(project.created_at)}</time>
            )}
            titleAccessoryLabel="创建时间"
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
      </div>
    </div>
  </div></div>;
}
