import { useQuery } from "@tanstack/react-query";
import {
  ClipboardCheck,
  Eye,
  FileText,
  Search,
  Timer,
  TriangleAlert
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { reviewDetectionsQueryOptions } from "@/api/review";
import type {
  ReviewDetectionListItem,
  ReviewDetectionStatus
} from "@/types/review";
import { formatDateTime } from "@/utils/projectDisplay";

const statusLabels: Record<ReviewDetectionStatus, string> = {
  detecting: "AI 检测中",
  pending_review: "待审核",
  reviewed: "已审核",
  completed: "已推送",
  failed: "检测失败"
};

const statusClass: Record<ReviewDetectionStatus, string> = {
  detecting: "detecting",
  pending_review: "reviewed",
  reviewed: "ready",
  completed: "ready",
  failed: "danger"
};

const defectLabels: Record<string, string> = {
  crack: "裂缝",
  spalling: "剥落",
  hollow: "空鼓",
  moisture: "潮湿"
};

function actionFor(result: ReviewDetectionListItem) {
  if (result.review_status === "pending_review" && result.report_id) {
    return {
      label: "开始审核",
      to: `/review/projects/${result.id}`,
      Icon: ClipboardCheck,
      disabled: false
    };
  }
  if (result.review_status === "reviewed" && result.report_id) {
    return {
      label: "预览报告并推送",
      to: `/reports/${result.report_id}?mode=review`,
      Icon: FileText,
      disabled: false
    };
  }
  if (result.review_status === "completed" && result.report_id) {
    return {
      label: "查看结果",
      to: `/reports/${result.report_id}`,
      Icon: Eye,
      disabled: false
    };
  }
  return {
    label: result.review_status === "failed" ? "检测失败" : "等待 AI 结果",
    to: `/review/projects/${result.id}`,
    Icon: result.review_status === "failed" ? TriangleAlert : Timer,
    disabled: true
  };
}

export function ReviewProjectListPage() {
  const resultsQuery = useQuery(reviewDetectionsQueryOptions);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<"all" | ReviewDetectionStatus>("all");
  const results = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLocaleLowerCase();
    return (resultsQuery.data ?? []).filter((result) => (
      (status === "all" || result.review_status === status)
      && `${result.project_name} ${result.project_no} ${result.client_name ?? ""}`
        .toLocaleLowerCase()
        .includes(normalizedKeyword)
    ));
  }, [keyword, resultsQuery.data, status]);

  return (
    <div className="review-workbench-page management-list-page">
      <div className="project-workspace">
        <section className="project-hero">
          <div className="management-page-title">
            <ClipboardCheck aria-hidden="true" className="management-page-title-icon" />
            <h1>审核工作台</h1>
          </div>
        </section>

        <section className="project-toolbar" aria-label="检测结果筛选">
          <label className="select-control">
            <span className="sr-only">按状态筛选</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as "all" | ReviewDetectionStatus)}
            >
              <option value="all">全部状态</option>
              <option value="detecting">AI 检测中</option>
              <option value="pending_review">待审核</option>
              <option value="reviewed">已审核</option>
              <option value="completed">已推送</option>
              <option value="failed">检测失败</option>
            </select>
          </label>
          <label className="search-control">
            <span className="sr-only">搜索项目</span>
            <Search aria-hidden="true" />
            <input
              placeholder="搜索项目名称、编号或委托单位"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </label>
        </section>

        {resultsQuery.isError ? (
          <p className="project-list-error">检测结果加载失败，请稍后重试。</p>
        ) : null}

        <section className="project-list-panel" aria-label="检测结果列表">
          <div className="project-table-wrap">
            {resultsQuery.isLoading ? (
              <div className="project-empty"><strong>正在加载检测结果…</strong></div>
            ) : results.length ? (
              <table className="project-table">
                <thead>
                  <tr>
                    <th>检测结果</th>
                    <th>照片</th>
                    <th>检测类型</th>
                    <th>AI 识别</th>
                    <th>当前状态</th>
                    <th>更新时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((result) => {
                    const action = actionFor(result);
                    const Icon = action.Icon;
                    return (
                      <tr key={result.id}>
                        <td data-label="检测结果">
                          <strong>{result.project_name}</strong>
                          <small>{result.project_no} · {result.task_no}</small>
                        </td>
                        <td data-label="照片">
                          <strong>{result.photo_count} 张</strong>
                          <small>项目检测照片</small>
                        </td>
                        <td data-label="检测类型">
                          {result.model_types.map((type) => defectLabels[type] ?? type).join("、") || "-"}
                        </td>
                        <td data-label="AI 识别">{result.ai_result_count} 项</td>
                        <td data-label="当前状态">
                          <span className={`status-tag ${statusClass[result.review_status]}`}>
                            {statusLabels[result.review_status]}
                          </span>
                        </td>
                        <td data-label="更新时间">{formatDateTime(result.updated_at)}</td>
                        <td data-label="操作">
                          {action.disabled ? (
                            <span className="table-action is-disabled">
                              <Icon aria-hidden="true" />{action.label}
                            </span>
                          ) : (
                            <Link
                              className={`table-action ${
                                result.review_status === "pending_review"
                                  ? "table-action-review"
                                  : ""
                              }`}
                              to={action.to}
                            >
                              <Icon aria-hidden="true" />{action.label}
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="project-empty">
                <strong>暂无检测结果</strong>
                <span>项目完成 AI 检测后会在这里显示一条记录。</span>
              </div>
            )}
          </div>
          <div className="project-pagination">
            <span>共 <strong>{results.length}</strong> 条</span>
          </div>
        </section>
      </div>
    </div>
  );
}
