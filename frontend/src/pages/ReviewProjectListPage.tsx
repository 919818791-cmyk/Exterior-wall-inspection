import { Button, Card, CardBody, Divider, Skeleton } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import {
  ClipboardCheck,
  Eye,
  FileText,
  RefreshCcw,
  Timer
} from "lucide-react";
import { Link as RouterLink } from "react-router-dom";

import { reviewProjectsQueryOptions } from "@/api/review";
import { StatusPill } from "@/components/StatusPill";
import type { ProjectStatus } from "@/types/projects";
import type { ReviewProjectListItem } from "@/types/review";
import { formatDateTime } from "@/utils/projectDisplay";

const REVIEW_STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "待检测",
  detecting: "AI检测中",
  pending_review: "待审核",
  reviewed: "已审核",
  completed: "已完成",
  failed: "检测失败"
};

const REVIEW_STATUS_TONES: Record<ProjectStatus, "success" | "warning" | "danger"> = {
  draft: "warning",
  detecting: "warning",
  pending_review: "warning",
  reviewed: "success",
  completed: "success",
  failed: "danger"
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function actionForProject(project: ReviewProjectListItem) {
  if (project.status === "pending_review") {
    return {
      label: "开始审核",
      to: `/review/projects/${project.id}`,
      icon: ClipboardCheck,
      disabled: false
    };
  }
  if (project.status === "reviewed") {
    return {
      label: "预览报告并推送",
      to: project.current_report_id ? `/reports/${project.current_report_id}?mode=review` : "/reports",
      icon: FileText,
      disabled: false
    };
  }
  if (project.status === "completed") {
    return {
      label: "查看报告",
      to: project.current_report_id ? `/reports/${project.current_report_id}` : "/reports",
      icon: Eye,
      disabled: false
    };
  }
  return {
    label: project.status === "detecting" ? "等待 AI 结果" : "不可审核",
    to: `/review/projects/${project.id}`,
    icon: Timer,
    disabled: true
  };
}

export function ReviewProjectListPage() {
  const projectsQuery = useQuery(reviewProjectsQueryOptions);
  const projects = projectsQuery.data ?? [];
  const pendingCount = projects.filter((project) => project.status === "pending_review").length;
  const detectingCount = projects.filter((project) => project.status === "detecting").length;
  const reviewedCount = projects.filter((project) => project.status === "reviewed").length;

  return (
    <div className="grid gap-5">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase text-action">Review Workbench</p>
          <h1 className="mt-2 text-3xl font-black text-ink">审核工作台</h1>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-7 text-slate-600">
            查看 AI 检测任务状态，进入待审核项目复核缺陷框并生成报告记录。
          </p>
        </div>
        <Button
          className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
          isLoading={projectsQuery.isFetching}
          startContent={<RefreshCcw className="h-4 w-4" aria-hidden="true" />}
          variant="flat"
          onPress={() => void projectsQuery.refetch()}
        >
          刷新
        </Button>
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        <MetricBlock label="待审核项目" value={String(pendingCount)} />
        <MetricBlock label="AI检测中" value={String(detectingCount)} />
        <MetricBlock label="已审核" value={String(reviewedCount)} />
        <MetricBlock label="工作台项目" value={String(projects.length)} />
      </section>

      <Card className="rounded-lg border border-slate-200 shadow-none">
        <CardBody className="gap-0 p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <h2 className="text-lg font-black text-ink">审核项目列表</h2>
              <p className="mt-1 text-xs font-bold text-slate-500">
                不展示待检测草稿项目；AI 回传结果后进入待审核。
              </p>
            </div>
          </div>
          <Divider />

          {projectsQuery.isLoading ? (
            <div className="grid gap-3 p-5">
              <Skeleton className="h-12 rounded-lg" />
              <Skeleton className="h-12 rounded-lg" />
              <Skeleton className="h-12 rounded-lg" />
            </div>
          ) : projectsQuery.isError ? (
            <div className="p-5">
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                {getErrorMessage(projectsQuery.error)}
              </div>
            </div>
          ) : projects.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-[1080px] w-full border-separate border-spacing-0 text-left text-sm">
                <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                  <tr>
                    <th className="border-b border-slate-200 px-5 py-3">项目</th>
                    <th className="border-b border-slate-200 px-5 py-3">委托单位</th>
                    <th className="border-b border-slate-200 px-5 py-3">照片</th>
                    <th className="border-b border-slate-200 px-5 py-3">AI结果</th>
                    <th className="border-b border-slate-200 px-5 py-3">审核结果</th>
                    <th className="border-b border-slate-200 px-5 py-3">状态</th>
                    <th className="border-b border-slate-200 px-5 py-3">更新时间</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => {
                    const action = actionForProject(project);
                    const Icon = action.icon;

                    return (
                      <tr key={project.id} className="align-middle hover:bg-slate-50">
                        <td className="border-b border-slate-100 px-5 py-4">
                          <div className="min-w-0">
                            <p className="truncate font-black text-ink">{project.name}</p>
                            <p className="mt-1 font-mono text-xs font-semibold text-slate-500">
                              {project.project_no}
                            </p>
                          </div>
                        </td>
                        <td className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-600">
                          {project.client_name || "-"}
                        </td>
                        <td className="border-b border-slate-100 px-5 py-4 font-black text-slate-700">
                          {project.photo_count}
                        </td>
                        <td className="border-b border-slate-100 px-5 py-4 font-black text-slate-700">
                          {project.ai_result_count}
                        </td>
                        <td className="border-b border-slate-100 px-5 py-4 font-black text-slate-700">
                          {project.review_result_count}
                        </td>
                        <td className="border-b border-slate-100 px-5 py-4">
                          <StatusPill tone={REVIEW_STATUS_TONES[project.status]}>
                            {REVIEW_STATUS_LABELS[project.status]}
                          </StatusPill>
                        </td>
                        <td className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-600">
                          {formatDateTime(project.updated_at)}
                        </td>
                        <td className="border-b border-slate-100 px-5 py-4">
                          <div className="flex justify-end">
                            <Button
                              as={RouterLink}
                              className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none disabled:opacity-40"
                              isDisabled={action.disabled}
                              size="sm"
                              startContent={<Icon className="h-4 w-4" aria-hidden="true" />}
                              to={action.to}
                              variant="flat"
                            >
                              {action.label}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid min-h-72 place-items-center p-6 text-center">
              <div>
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-action-soft text-action">
                  <ClipboardCheck className="h-6 w-6" aria-hidden="true" />
                </span>
                <h2 className="mt-4 text-xl font-black text-ink">暂无审核项目</h2>
                <p className="mt-2 text-sm font-semibold text-slate-500">
                  项目启动 AI 检测后会进入这里。
                </p>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function MetricBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-black uppercase text-slate-500">{label}</p>
      <strong className="mt-2 block text-2xl font-black text-ink">{value}</strong>
    </div>
  );
}
