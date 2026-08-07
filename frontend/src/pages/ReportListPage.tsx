import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { reportsQueryOptions } from "@/api/reports";
import { ListPagination } from "@/components/ListPagination";
import { WorkbenchStatusBadge, type WorkbenchStatusVariant } from "@/components/WorkbenchStatusBadge";
import { WorkbenchDefectSummary, WorkbenchResultTable } from "@/components/WorkbenchResultTable";
import { useAuthStore } from "@/stores/useAuthStore";
import type { InspectionReportStatus } from "@/types/review";

const reportStatusLabels: Record<InspectionReportStatus, string> = {
  draft: "草稿",
  generated: "已完成",
  pushed: "已完成",
  revoked: "已撤销"
};

const reportStatusVariants: Record<InspectionReportStatus, WorkbenchStatusVariant> = {
  draft: "draft",
  generated: "completed",
  pushed: "completed",
  revoked: "draft"
};

const PAGE_SIZE = 5;

export function ReportListPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const reportsQuery = useQuery(reportsQueryOptions(user));
  const [searchKeyword, setSearchKeyword] = useState("");
  const [page, setPage] = useState(1);
  const reports = useMemo(() => reportsQuery.data ?? [], [reportsQuery.data]);
  const matchingReports = useMemo(() => {
    const keyword = searchKeyword.trim().toLocaleLowerCase();
    if (!keyword) return reports;
    return reports.filter((report) => report.title.toLocaleLowerCase().includes(keyword));
  }, [reports, searchKeyword]);
  const totalPages = Math.max(1, Math.ceil(matchingReports.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedReports = matchingReports.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return <div className="report-list-page project-management-page workbench-result-list-page trial-records-page"><div className="project-workspace">
    <div className="project-workbench-layout">
      <div className="project-workbench-content-panel">
        <header className="list-page-heading">
          <div className="list-page-heading-row">
            <h1>免费试用</h1>
            <Link className="list-page-heading-action" to="/trial"><Plus aria-hidden="true" />开始试用</Link>
          </div>
          <p>上传照片即可体验 AI 外墙缺陷检测，快速了解结果样式。</p>
        </header>
        {reports.length ? <div
          className="project-list-search-toolbar"
          role="search"
        >
          <input
            aria-label="搜索试用记录"
            placeholder="输入结果名称"
            type="search"
            value={searchKeyword}
            onChange={(event) => {
              setSearchKeyword(event.target.value);
              setPage(1);
            }}
          />
        </div> : null}
        {reportsQuery.isError ? <p className="project-list-error">检测结果加载失败。<button className="inline-retry-button" type="button" onClick={() => void reportsQuery.refetch()}>重新加载</button></p> : null}
        <section className="project-list-panel workbench-result-list-panel" aria-label="试用记录列表"><div className="project-table-wrap project-workbench-table-wrap">
          {reportsQuery.isLoading ? <div className="project-empty"><strong>正在加载结果…</strong></div> : matchingReports.length ? <WorkbenchResultTable
            getAriaLabel={(report) => `查看检测结果：${report.title}`}
            getKey={(report) => report.id}
            items={pagedReports}
            onOpen={(report) => navigate(`/reports/${report.id}`)}
            renderDetectionDescription={(report) => <WorkbenchDefectSummary counts={report.by_defect_type} />}
            renderTitleAccessory={(report) => <WorkbenchStatusBadge
              className="project-name-status-icon"
              label={reportStatusLabels[report.status]}
              variant={reportStatusVariants[report.status]}
            />}
          /> : reports.length && searchKeyword.trim() ? <div className="project-empty"><strong>未找到匹配的试用记录</strong></div> : <ReportEmptyState />}
        </div>
        {matchingReports.length ? <ListPagination
          currentPage={currentPage}
          onPageChange={setPage}
          pageSize={PAGE_SIZE}
          totalItems={matchingReports.length}
        /> : null}
        </section>
      </div>
    </div>
  </div></div>;
}

function ReportEmptyState() {
  return <div className="project-empty project-workbench-empty project-workbench-welcome-empty">
    <span className="project-welcome-supporting-copy">暂无试用记录，上传照片即可体验智能检测</span>
  </div>;
}
