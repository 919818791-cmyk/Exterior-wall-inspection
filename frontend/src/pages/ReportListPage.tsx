import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { deleteReport, reportsQueryOptions } from "@/api/reports";
import type { ReportListItem } from "@/types/reports";
import { formatDateTime } from "@/utils/projectDisplay";

const reportStatus = { draft: ["草稿", "neutral"], generated: ["已生成", "detecting"], pushed: ["已推送", "ready"], revoked: ["已撤回", "neutral"] } as const;

export function ReportListPage() {
  const reportsQuery = useQuery(reportsQueryOptions);
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const reports = useMemo(() => (reportsQuery.data ?? []).filter((report) => `${report.title} ${report.report_no}`.toLowerCase().includes(keyword.trim().toLowerCase())), [keyword, reportsQuery.data]);
  const deleteMutation = useMutation({
    mutationFn: deleteReport,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["reports"] });
    }
  });

  function removeReport(report: ReportListItem) {
    const confirmed = window.confirm(`确认删除检测结果“${report.title}”？删除后将从检测结果列表移除。`);
    if (confirmed) deleteMutation.mutate(report.id);
  }

  return <div className="report-list-page"><div className="project-workspace">
    <section className="project-hero"><div><h1>检测结果</h1><p>统一查看正式项目结果和 AI 检测体验归档，在线预览生成过程与识别结果。</p></div></section>
    <section className="project-toolbar report-toolbar" aria-label="结果检索"><label className="search-control"><span className="sr-only">搜索结果名称或编号</span><Search aria-hidden="true" /><input placeholder="搜索结果名称或编号" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></label></section>
    {reportsQuery.isError ? <p className="project-list-error">检测结果加载失败，请稍后重试。</p> : null}
    {deleteMutation.isError ? <p className="project-list-error">检测结果删除失败，请稍后重试。</p> : null}
    <section className="project-list-panel" aria-label="检测结果列表"><div className="project-table-wrap">
      {reportsQuery.isLoading ? <div className="project-empty"><strong>正在加载结果…</strong></div> : reports.length ? <table className="project-table"><thead><tr><th>结果名称</th><th>识别数量</th><th>结果状态</th><th>生成时间</th><th>操作</th></tr></thead><tbody>{reports.map((report) => <ReportRow key={report.id} report={report} isDeleting={deleteMutation.isPending} onDelete={removeReport} />)}</tbody></table> : <div className="project-empty"><strong>没有匹配的结果</strong><span>正式检测结果和体验归档会在这里统一排列</span></div>}
    </div><div className="project-pagination"><span>共 <strong>{reports.length}</strong> 条</span><div><button aria-label="上一页" disabled type="button">‹</button><button aria-current="page" className="current-page" type="button">1</button><button aria-label="下一页" disabled type="button">›</button><span className="page-size">10 条/页</span></div></div></section>
  </div></div>;
}

function ReportRow({ report, isDeleting, onDelete }: { report: ReportListItem; isDeleting: boolean; onDelete: (report: ReportListItem) => void }) {
  const [label, tone] = reportStatus[report.status];
  return <tr><td data-label="结果名称"><strong>{report.title}</strong><small>{report.report_no}</small></td><td data-label="识别数量">{report.total_defects} 项</td><td data-label="结果状态"><span className={`status-tag ${tone}`}>{label}</span></td><td data-label="生成时间">{formatDateTime(report.generated_at)}</td><td data-label="操作"><div className="table-actions"><Link className="table-action" to={`/reports/${report.id}`}><Eye aria-hidden="true" />查看结果</Link><button className="table-action danger-table-action" disabled={isDeleting} type="button" onClick={() => onDelete(report)}><Trash2 aria-hidden="true" />删除</button></div></td></tr>;
}
