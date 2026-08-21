import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";

import { deleteReport, reportsQueryOptions, updateTrialReportTitle } from "@/api/reports";
import { WorkbenchDefectSummary, WorkbenchResultTable } from "@/components/WorkbenchResultTable";
import { useAuthStore } from "@/stores/useAuthStore";
import type { ReportListItem } from "@/types/reports";
import { formatDateTime } from "@/utils/projectDisplay";

export function ReportListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
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

  const reports = useMemo(() => reportsQuery.data ?? [], [reportsQuery.data]);
  const showReportEmptyState = !reportsQuery.isLoading && reports.length === 0;
  return <div className="report-list-page project-management-page workbench-result-list-page trial-records-page"><div className="project-workspace">
    <div className="project-workbench-layout">
      <div className="project-workbench-content-panel">
        <header className={`list-page-heading${showReportEmptyState ? " list-page-heading-empty-hidden" : ""}`}>
          <div className="list-page-heading-row">
            <h1>免费试用</h1>
          </div>
          <p>上传照片即可体验 AI 外墙缺陷检测，快速了解结果样式。</p>
          {reports.length ? <Link className="list-page-heading-action" to="/trials/new"><Plus aria-hidden="true" />开始试用</Link> : null}
        </header>
        {reportsQuery.isError ? <p className="project-list-error">检测结果加载失败。<button className="inline-retry-button" type="button" onClick={() => void reportsQuery.refetch()}>重新加载</button></p> : null}
        {renameReportMutation.isError || deleteReportMutation.isError ? <p className="project-list-error" role="alert">操作失败，请稍后重试。</p> : null}
        <section
          className={`project-list-panel workbench-result-list-panel${showReportEmptyState ? " project-list-empty-surface" : ""}`}
          aria-label="试用记录列表"
        >
          <div className="project-table-wrap project-workbench-table-wrap">
          {reportsQuery.isLoading ? <div className="project-empty"><strong>正在加载结果…</strong></div> : reports.length ? <WorkbenchResultTable
            getKey={(report) => report.id}
            items={reports}
            onDelete={handleDeleteReport}
            onOpen={(report) => navigate(`/trials/${report.id}`)}
            onRename={handleRenameReport}
            openOnRowClick
            renderCompletionTime={(report) => (
              <time dateTime={report.generated_at}>{formatDateTime(report.generated_at)}</time>
            )}
            renderDetectionDescription={(report) => <WorkbenchDefectSummary counts={report.by_defect_type} variant="compact" />}
          /> : <ReportEmptyState />}
        </div>
        </section>
      </div>
    </div>
  </div></div>;
}

function ReportEmptyState() {
  return <div className="project-empty project-workbench-empty project-workbench-welcome-empty public-list-hero-empty">
    <span className="project-welcome-supporting-copy project-empty-hero-title">
      <span className="project-empty-hero-title-primary">上传照片</span>
      <span className="project-empty-hero-title-gradient">开始第一次免费试用</span>
    </span>
    <Link className="public-empty-cta-card" to="/trials/new">
      <span className="public-empty-card-copy">
        <strong>开始试用<ChevronRight aria-hidden="true" /></strong>
        <span>上传照片即可体验 AI 外墙缺陷检测，快速了解结果样式。</span>
      </span>
    </Link>
  </div>;
}
