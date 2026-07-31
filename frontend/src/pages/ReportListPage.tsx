import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Eye, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { deleteReport, reportsQueryOptions, restoreTrialReport } from "@/api/reports";
import { ResultFolderThumbnail } from "@/components/ResultFolderThumbnail";
import { useAuthStore } from "@/stores/useAuthStore";
import type { ReportListItem } from "@/types/reports";
import { formatDateTime } from "@/utils/projectDisplay";

interface RecentlyDeletedReport {
  report: ReportListItem;
  originalIndex: number;
}

export function ReportListPage() {
  const user = useAuthStore((state) => state.user);
  const reportsQuery = useQuery(reportsQueryOptions(user));
  const queryClient = useQueryClient();
  const [recentlyDeletedReport, setRecentlyDeletedReport] = useState<RecentlyDeletedReport | null>(null);
  const reportRows = useMemo(() => {
    const rows = (reportsQuery.data ?? []).map((report) => ({
      isDeleted: recentlyDeletedReport?.report.id === report.id,
      report
    }));
    if (recentlyDeletedReport && !rows.some(({ report }) => report.id === recentlyDeletedReport.report.id)) {
      rows.splice(Math.max(0, Math.min(recentlyDeletedReport.originalIndex, rows.length)), 0, {
        isDeleted: true,
        report: recentlyDeletedReport.report
      });
    }
    return rows;
  }, [recentlyDeletedReport, reportsQuery.data]);
  const deleteMutation = useMutation({
    mutationFn: (report: ReportListItem) => deleteReport(report.id),
    onSuccess: async (_result, deleted) => {
      setRecentlyDeletedReport(deleted.source_type === "trial"
        ? {
            report: deleted,
            originalIndex: reportsQuery.data?.findIndex((report) => report.id === deleted.id) ?? 0
          }
        : null);
      await queryClient.invalidateQueries({ queryKey: ["reports"] });
    }
  });
  const restoreMutation = useMutation({
    mutationFn: restoreTrialReport,
    onSuccess: async () => {
      setRecentlyDeletedReport(null);
      await queryClient.invalidateQueries({ queryKey: ["reports"] });
    }
  });

  function removeReport(report: ReportListItem) {
    const confirmed = window.confirm(
      report.source_type === "trial"
        ? `确认从列表移除简易检测结果“${report.title}”？移除后可立即撤销。`
        : `确认永久删除正式检测报告“${report.title}”？关联的报告文件也会被删除，此操作不可撤销。`
    );
    if (confirmed) {
      restoreMutation.reset();
      deleteMutation.mutate(report);
    }
  }

  return <div className="report-list-page"><div className="project-workspace">
    <section className="project-hero">
      <div className="management-page-title">
        <Sparkles aria-hidden="true" className="management-page-title-icon" />
        <h1>试用记录</h1>
      </div>
    </section>
    <div className="project-workbench-content-panel">
      {reportsQuery.isError ? <p className="project-list-error">检测结果加载失败。<button className="inline-retry-button" type="button" onClick={() => void reportsQuery.refetch()}>重新加载</button></p> : null}
      {deleteMutation.isError ? <p className="project-list-error">检测结果删除失败：{deleteMutation.error instanceof Error ? deleteMutation.error.message : "请稍后重试。"}</p> : null}
      <section className="project-list-panel" aria-label="试用记录列表"><div className="project-table-wrap project-workbench-table-wrap">
        {reportsQuery.isLoading ? <div className="project-empty"><strong>正在加载结果…</strong></div> : reportRows.length ? <table className="project-table report-list-table project-workbench-table"><tbody>{reportRows.map(({ report, isDeleted }) => isDeleted
          ? <DeletedReportRow key={report.id} report={report} restoreError={restoreMutation.error} isRestoring={restoreMutation.isPending} onRestore={() => restoreMutation.mutate(report.id)} />
          : <ReportRow key={report.id} report={report} canDelete={report.source_type === "trial" || user?.role === "reviewer" || user?.role === "admin"} isDeleting={deleteMutation.isPending} onDelete={removeReport} />
        )}</tbody></table> : <ReportEmptyState />}
      </div></section>
    </div>
  </div></div>;
}

function ReportEmptyState() {
  return <div className="project-empty project-workbench-empty project-workbench-welcome-empty">
    <strong className="project-welcome-copy">欢迎使用外墙智能检测功能</strong>
    <span className="project-welcome-supporting-copy">当前没有试用记录，来免费体验一下吧</span>
    <Link className="button primary project-empty-create-button" to="/trial"><Sparkles aria-hidden="true" />免费试用</Link>
  </div>;
}

function DeletedReportRow({ report, restoreError, isRestoring, onRestore }: { report: ReportListItem; restoreError: Error | null; isRestoring: boolean; onRestore: () => void }) {
  return <tr className="report-list-row report-delete-row"><td className="report-delete-cell" colSpan={4}><div className="report-delete-feedback" role="status"><span className="report-delete-summary"><CheckCircle2 aria-hidden="true" /><strong>删除成功</strong><span>“{report.title}”已从列表移除</span></span><span className="report-delete-actions">{restoreError ? <span className="report-delete-error">撤销失败，请重试</span> : null}<button className="button secondary report-back-button report-delete-undo-button" disabled={isRestoring} type="button" onClick={onRestore}>{isRestoring ? "恢复中…" : "撤销删除"}</button></span></div></td></tr>;
}

function ReportRow({ report, canDelete, isDeleting, onDelete }: { report: ReportListItem; canDelete: boolean; isDeleting: boolean; onDelete: (report: ReportListItem) => void }) {
  return <tr className="report-list-row"><td className="result-folder-column"><ResultFolderThumbnail firstPhotoUrl={report.first_photo_url} title={report.title} /></td><td className="report-name-column list-primary-column" data-label="结果名称"><span className="result-name-content"><strong>{report.title}</strong><small className="result-generated-time">{formatDateTime(report.generated_at)}</small></span><Link className="report-mobile-row-link" aria-label={`查看检测结果：${report.title}`} to={`/reports/${report.id}`} /></td><td className="report-count-column" data-label="照片数量">{report.photo_count} 张</td><td className="report-action-column list-action-column" data-label="操作"><div className="table-actions"><Link className="table-action table-action-result" to={`/reports/${report.id}`}><Eye aria-hidden="true" />查看结果</Link>{canDelete ? <button className="table-action danger-table-action" disabled={isDeleting} type="button" onClick={() => onDelete(report)}><Trash2 aria-hidden="true" />删除</button> : null}</div></td></tr>;
}
