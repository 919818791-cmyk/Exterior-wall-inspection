import { useQuery } from "@tanstack/react-query";
import { Gauge, Images, Plus, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";

import { currentAccountUsageQueryOptions } from "@/api/accounts";
import { reportsQueryOptions } from "@/api/reports";
import { WorkbenchResultTable } from "@/components/WorkbenchResultTable";
import { useAuthStore } from "@/stores/useAuthStore";

export function ReportListPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const reportsQuery = useQuery(reportsQueryOptions(user));
  const accountUsageQuery = useQuery(currentAccountUsageQueryOptions);
  const reports = reportsQuery.data ?? [];
  const completedPhotoCount = useMemo(() => {
    return reports.reduce((total, report) => total + report.photo_count, 0);
  }, [reports]);

  return <div className="report-list-page project-management-page workbench-result-list-page trial-records-page"><div className="project-workspace">
    <h1 className="sr-only">试用记录</h1>
    <div className="project-workbench-layout">
      <TrialRecordsSidebar
        completedPhotoCount={completedPhotoCount}
        isQuotaError={accountUsageQuery.isError}
        isQuotaLoading={accountUsageQuery.isLoading}
        onRetryQuota={() => void accountUsageQuery.refetch()}
        quota={accountUsageQuery.data?.trial_api_request_balance}
      />
      <div className="project-workbench-content-panel">
        {reportsQuery.isError ? <p className="project-list-error">检测结果加载失败。<button className="inline-retry-button" type="button" onClick={() => void reportsQuery.refetch()}>重新加载</button></p> : null}
        <section className="project-list-panel" aria-label="试用记录列表"><div className="project-table-wrap project-workbench-table-wrap">
          {reportsQuery.isLoading ? <div className="project-empty"><strong>正在加载结果…</strong></div> : reports.length ? <WorkbenchResultTable
            getAriaLabel={(report) => `查看检测结果：${report.title}`}
            getKey={(report) => report.id}
            items={reports}
            onOpen={(report) => navigate(`/reports/${report.id}`)}
          /> : <ReportEmptyState />}
        </div></section>
      </div>
    </div>
  </div></div>;
}

function TrialRecordsSidebar({
  completedPhotoCount,
  isQuotaError,
  isQuotaLoading,
  onRetryQuota,
  quota
}: {
  completedPhotoCount: number;
  isQuotaError: boolean;
  isQuotaLoading: boolean;
  onRetryQuota: () => void;
  quota: { limit: number; remaining: number } | undefined;
}) {
  const quotaPercent = quota && quota.limit > 0
    ? Math.min(100, Math.max(0, quota.remaining / quota.limit * 100))
    : 0;

  return <aside className="project-workbench-sidebar trial-records-sidebar" aria-label="试用记录概览">
    <Link className="project-sidebar-new-project" to="/trial">
      <span className="project-sidebar-new-icon"><Plus aria-hidden="true" /></span>
      <span><strong>免费试用</strong><small>开始检测体验</small></span>
    </Link>

    <section className="project-sidebar-completion-summary" aria-label="累计照片检测数量">
      <Images aria-hidden="true" />
      <div>
        <span>累计完成照片检测</span>
        <p><strong>{completedPhotoCount}</strong><small>张</small></p>
      </div>
    </section>

    <section className="project-sidebar-quota" aria-labelledby="trial-records-quota-title">
      <div className="project-sidebar-card-heading">
        <span><Gauge aria-hidden="true" /><strong id="trial-records-quota-title">检测额度</strong></span>
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

function ReportEmptyState() {
  return <div className="project-empty project-workbench-empty project-workbench-welcome-empty">
    <span className="project-welcome-supporting-copy">暂无试用记录，上传照片即可体验智能检测</span>
    <Link className="button primary project-empty-create-button" to="/trial"><Plus aria-hidden="true" />免费试用</Link>
  </div>;
}
