import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { reportsQueryOptions } from "@/api/reports";
import { ListPagination } from "@/components/ListPagination";
import { WorkbenchDefectSummary, WorkbenchResultTable } from "@/components/WorkbenchResultTable";
import { useAuthStore } from "@/stores/useAuthStore";
import { formatDateTime } from "@/utils/projectDisplay";

const PAGE_SIZE = 10;

export function ReportListPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [currentPage, setCurrentPage] = useState(1);
  const [reportNameSearch, setReportNameSearch] = useState("");
  const reportsQuery = useQuery(reportsQueryOptions(user));
  const reports = useMemo(
    () => [...(reportsQuery.data ?? [])].sort((a, b) => (
      Number(b.is_example) - Number(a.is_example)
      || b.created_at.localeCompare(a.created_at)
    )),
    [reportsQuery.data]
  );
  const matchingReports = useMemo(() => {
    const search = reportNameSearch.trim().toLocaleLowerCase();
    if (!search) return reports;
    return reports.filter((report) => report.title.toLocaleLowerCase().includes(search));
  }, [reportNameSearch, reports]);
  const totalPages = Math.max(1, Math.ceil(matchingReports.length / PAGE_SIZE));
  const visiblePage = Math.min(currentPage, totalPages);
  const paginatedReports = useMemo(() => {
    const startIndex = (visiblePage - 1) * PAGE_SIZE;
    return matchingReports.slice(startIndex, startIndex + PAGE_SIZE);
  }, [matchingReports, visiblePage]);
  return <div className="report-list-page project-management-page workbench-result-list-page trial-records-page"><div className="project-workspace">
    <div className="project-workbench-layout">
      <div className="project-workbench-content-panel">
        {reportsQuery.isError ? <p className="project-list-error">检测结果加载失败。<button className="inline-retry-button" type="button" onClick={() => void reportsQuery.refetch()}>重新加载</button></p> : null}
        <section
          className="project-list-panel workbench-result-list-panel"
          aria-label="试用记录列表"
        >
          {reports.length ? <div className="project-name-search-toolbar">
            <label className="project-name-search-field floating-line-field">
              <input
                aria-label="搜索快速体验项目"
                autoComplete="off"
                placeholder=" "
                type="search"
                value={reportNameSearch}
                onChange={(event) => {
                  setReportNameSearch(event.target.value);
                  setCurrentPage(1);
                }}
              />
              <span>搜索快速体验项目</span>
            </label>
          </div> : null}
          <div className="project-table-wrap project-workbench-table-wrap">
          {reportsQuery.isLoading ? <div className="project-empty"><strong>正在加载结果…</strong></div> : reports.length && matchingReports.length ? <WorkbenchResultTable
            getKey={(report) => report.id}
            items={paginatedReports}
            onOpen={(report) => navigate(`/trials/${report.id}`)}
            openOnRowClick
            completionTimeLabel="创建时间"
            renderCompletionTime={(report) => (
              <time dateTime={report.created_at}>{formatDateTime(report.created_at)}</time>
            )}
            renderDetectionDescription={(report) => <WorkbenchDefectSummary counts={report.by_defect_type} variant="compact" />}
          /> : reports.length ? <div className="project-empty project-search-empty-state">
            <strong>未找到匹配的快速体验项目</strong>
            <span>请尝试其他项目名称。</span>
          </div> : null}
        </div>
        <ListPagination
          currentPage={visiblePage}
          onPageChange={setCurrentPage}
          pageSize={PAGE_SIZE}
          totalItems={matchingReports.length}
        />
        </section>
        <p className="list-page-switch-prompt">
          提示：想要更准确、更全面的检测结果？可前往<Link to="/detections">专业检测页面</Link>。
        </p>
      </div>
    </div>
  </div></div>;
}
