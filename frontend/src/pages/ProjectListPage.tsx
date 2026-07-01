import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { deleteProject, projectsQueryOptions } from "@/api/projects";
import { useAuthStore } from "@/stores/useAuthStore";
import type { ProjectStatus } from "@/types/projects";
import { formatDateTime, formatLocation, PROJECT_STATUS_LABELS } from "@/utils/projectDisplay";

const statusClass: Record<ProjectStatus, string> = {
  draft: "neutral", detecting: "detecting", pending_review: "detecting", reviewed: "ready", completed: "ready"
};

export function ProjectListPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const projectsQuery = useQuery(projectsQueryOptions);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<"all" | ProjectStatus>("all");
  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["projects"] })
  });
  const visibleProjects = useMemo(() => (projectsQuery.data ?? [])
    .filter((project) => status === "all" || project.status === status)
    .filter((project) => `${project.name} ${project.project_no} ${formatLocation(project)}`.toLowerCase().includes(keyword.trim().toLowerCase()))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [keyword, projectsQuery.data, status]);

  function removeProject(project: { id: string; name: string }) {
    if (window.confirm(`确认删除项目“${project.name}”？此操作会软删除项目、建筑和立面。`)) deleteMutation.mutate(project.id);
  }

  return <div className="project-workspace">
    <section className="project-hero">
      <div><h1>项目工作台</h1><p>集中管理外墙巡检项目、建筑信息与立面采集任务。</p></div>
      <div className="project-hero-action"><Link className="button primary new-project-button" to="/projects/new"><Plus aria-hidden="true" />新建项目</Link></div>
    </section>

    <section className="project-toolbar" aria-label="项目筛选">
      <label className="select-control"><span className="sr-only">按状态筛选</span><select value={status} onChange={(event) => setStatus(event.target.value as "all" | ProjectStatus)}><option value="all">全部状态</option><option value="draft">待检测</option><option value="detecting">AI检测中</option>{user?.role !== "customer" ? <><option value="pending_review">待审核</option><option value="reviewed">已审核</option></> : null}<option value="completed">已完成</option></select></label>
      <label className="search-control"><span className="sr-only">搜索项目名称或建筑地址</span><Search aria-hidden="true" /><input placeholder="搜索项目名称、编号或建筑位置" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></label>
    </section>

    {projectsQuery.isError || deleteMutation.isError ? <p className="project-list-error">{projectsQuery.isError ? "项目列表加载失败，请稍后重试。" : "删除项目失败，请稍后重试。"}</p> : null}
    <section className="project-list-panel" aria-label="项目列表">
      <div className="project-table-wrap">
        {projectsQuery.isLoading ? <div className="project-empty"><strong>正在加载项目…</strong></div> : visibleProjects.length ? <table className="project-table"><thead><tr><th>项目名称</th><th>建筑位置</th><th>当前状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{visibleProjects.map((project) => <tr key={project.id}><td data-label="项目名称"><strong>{project.name}</strong><small>{project.project_no}</small></td><td data-label="建筑位置">{formatLocation(project)}</td><td data-label="当前状态"><span className={`status-tag ${statusClass[project.status]}`}>{PROJECT_STATUS_LABELS[project.status]}</span></td><td data-label="更新时间">{formatDateTime(project.updated_at)}</td><td data-label="操作"><div className="table-actions"><Link className="table-action" to={`/projects/${project.id}`}><Eye aria-hidden="true" />查看详情</Link>{project.status === "draft" ? <button className="table-action danger-table-action" disabled={deleteMutation.isPending} type="button" onClick={() => removeProject(project)}><Trash2 aria-hidden="true" />删除</button> : null}</div></td></tr>)}</tbody></table> : <div className="project-empty"><strong>没有匹配的项目</strong><span>尝试调整筛选条件或搜索关键词</span></div>}
      </div>
      <div className="project-pagination"><span>共 <strong>{visibleProjects.length}</strong> 项</span><div><button aria-label="上一页" disabled type="button">‹</button><button aria-current="page" className="current-page" type="button">1</button><button aria-label="下一页" disabled type="button">›</button><span className="page-size">10 条/页</span></div></div>
    </section>
  </div>;
}
