import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { deleteReport, reportsQueryOptions, updateTrialReportTitle } from "@/api/reports";
import { ListPagination } from "@/components/ListPagination";
import { WorkbenchDefectSummary, WorkbenchResultTable } from "@/components/WorkbenchResultTable";
import { useAuthStore } from "@/stores/useAuthStore";
import type { ReportListItem } from "@/types/reports";
import { formatDateTime } from "@/utils/projectDisplay";

const PAGE_SIZE = 10;

export function ReportListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [currentPage, setCurrentPage] = useState(1);
  const [reportNameSearch, setReportNameSearch] = useState("");
  const reportsQuery = useQuery(reportsQueryOptions(user));
  const renameReportMutation = useMutation({
    mutationFn: ({ reportId, title }: { reportId: string; title: string }) => updateTrialReportTitle(reportId, title),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["reports"] });
    }
  });
  const deleteReportMutation = useMutation({
    mutationFn: deleteReport,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] })
      ]);
    }
  });

  const handleRenameReport = (report: ReportListItem) => {
    const nextTitle = window.prompt("请输入新的检测名称", report.title);
    if (nextTitle === null) return;
    const title = nextTitle.trim();
    if (!title) {
      window.alert("检测名称不能为空。");
      return;
    }
    if (title === report.title) return;
    renameReportMutation.mutate({ reportId: report.id, title });
  };

  const handleDeleteReport = (report: ReportListItem) => {
    if (!window.confirm(`确认删除试用结果“${report.title}”？删除后将无法恢复。`)) return;
    deleteReportMutation.mutate(report.id);
  };

  const reports = useMemo(
    () => [...(reportsQuery.data ?? [])].sort((a, b) => (
      Number(b.is_example) - Number(a.is_example)
      || b.generated_at.localeCompare(a.generated_at)
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
        {renameReportMutation.isError || deleteReportMutation.isError ? <p className="project-list-error" role="alert">操作失败，请稍后重试。</p> : null}
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
            canDelete={(report) => !report.is_example}
            canRename={(report) => !report.is_example}
            getDeleteDisabledReason={() => "示例项目为所有账号共享，无法删除"}
            onDelete={handleDeleteReport}
            onOpen={(report) => navigate(`/trials/${report.id}`)}
            onRename={handleRenameReport}
            openOnRowClick
            renderCompletionTime={(report) => (
              <time dateTime={report.generated_at}>{formatDateTime(report.generated_at)}</time>
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
