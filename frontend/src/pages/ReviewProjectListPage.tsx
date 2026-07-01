import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Eye, FileText, Search, Timer } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { reviewProjectsQueryOptions } from "@/api/review";
import type { ProjectStatus } from "@/types/projects";
import type { ReviewProjectListItem } from "@/types/review";
import { formatDateTime } from "@/utils/projectDisplay";

const statusLabels: Record<ProjectStatus, string> = { draft: "待检测", detecting: "AI检测中", pending_review: "待审核", reviewed: "已审核", completed: "已完成" };
const statusClass: Record<ProjectStatus, string> = { draft: "neutral", detecting: "detecting", pending_review: "reviewed", reviewed: "ready", completed: "ready" };

function actionFor(project: ReviewProjectListItem) {
  if (project.status === "pending_review") return { label: "开始审核", to: `/review/projects/${project.id}`, Icon: ClipboardCheck, disabled: false };
  if (project.status === "reviewed") return { label: "预览报告并推送", to: project.current_report_id ? `/reports/${project.current_report_id}?mode=review` : "/reports", Icon: FileText, disabled: false };
  if (project.status === "completed") return { label: "查看结果", to: project.current_report_id ? `/reports/${project.current_report_id}` : "/reports", Icon: Eye, disabled: false };
  return { label: project.status === "detecting" ? "等待 AI 结果" : "不可审核", to: `/review/projects/${project.id}`, Icon: Timer, disabled: true };
}

export function ReviewProjectListPage() {
  const projectsQuery = useQuery(reviewProjectsQueryOptions);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<"all" | ProjectStatus>("all");
  const projects = useMemo(() => (projectsQuery.data ?? []).filter((project) => (status === "all" || project.status === status) && `${project.name} ${project.project_no} ${project.client_name ?? ""}`.toLowerCase().includes(keyword.trim().toLowerCase())), [keyword, projectsQuery.data, status]);
  return <div className="review-workbench-page"><div className="project-workspace">
    <section className="project-hero"><div><h1>审核工作台</h1><p>查看 AI 检测任务状态，进入待审核项目复核缺陷并生成报告记录。</p></div></section>
    <section className="project-toolbar" aria-label="审核项目筛选"><label className="select-control"><span className="sr-only">按状态筛选</span><select value={status} onChange={(event) => setStatus(event.target.value as "all" | ProjectStatus)}><option value="all">全部状态</option><option value="detecting">AI检测中</option><option value="pending_review">待审核</option><option value="reviewed">已审核</option><option value="completed">已完成</option></select></label><label className="search-control"><span className="sr-only">搜索项目名称或建筑地址</span><Search aria-hidden="true" /><input placeholder="搜索项目名称、编号或委托单位" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></label></section>
    {projectsQuery.isError ? <p className="project-list-error">审核项目加载失败，请稍后重试。</p> : null}
    <section className="project-list-panel" aria-label="审核项目列表"><div className="project-table-wrap">{projectsQuery.isLoading ? <div className="project-empty"><strong>正在加载审核项目…</strong></div> : projects.length ? <table className="project-table"><thead><tr><th>项目名称</th><th>委托单位</th><th>AI识别</th><th>审核结果</th><th>当前状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{projects.map((project) => { const action = actionFor(project); const Icon = action.Icon; return <tr key={project.id}><td data-label="项目名称"><strong>{project.name}</strong><small>{project.project_no}</small></td><td data-label="委托单位">{project.client_name || "-"}</td><td data-label="AI识别">{project.ai_result_count} 项</td><td data-label="审核结果">{project.review_result_count} 项</td><td data-label="当前状态"><span className={`status-tag ${statusClass[project.status]}`}>{statusLabels[project.status]}</span></td><td data-label="更新时间">{formatDateTime(project.updated_at)}</td><td data-label="操作">{action.disabled ? <span className="table-action is-disabled"><Icon aria-hidden="true" />{action.label}</span> : <Link className={`table-action ${project.status === "pending_review" ? "table-action-review" : ""}`} to={action.to}><Icon aria-hidden="true" />{action.label}</Link>}</td></tr>; })}</tbody></table> : <div className="project-empty"><strong>暂无审核项目</strong><span>项目启动 AI 检测后会进入这里。</span></div>}</div><div className="project-pagination"><span>共 <strong>{projects.length}</strong> 项</span><div><button aria-label="上一页" disabled type="button">‹</button><button aria-current="page" className="current-page" type="button">1</button><button aria-label="下一页" disabled type="button">›</button><span className="page-size">10 条/页</span></div></div></section>
  </div></div>;
}
