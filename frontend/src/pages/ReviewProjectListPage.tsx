import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Box,
  ClipboardCheck,
  Eye,
  Timer,
  TriangleAlert
} from "lucide-react";
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
  reviewed: "已完成",
  completed: "已完成",
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
      to: `/review/detections/${result.id}`,
      Icon: ClipboardCheck,
      disabled: false
    };
  }
  if (
    (result.review_status === "reviewed" || result.review_status === "completed")
    && result.report_id
  ) {
    return {
      label: "再次审核",
      to: `/review/detections/${result.id}`,
      Icon: ClipboardCheck,
      disabled: false
    };
  }
  return {
    label: result.review_status === "failed" ? "检测失败" : "等待 AI 结果",
    to: `/review/detections/${result.id}`,
    Icon: result.review_status === "failed" ? TriangleAlert : Timer,
    disabled: true
  };
}

export function ReviewProjectListPage() {
  const resultsQuery = useQuery({
    ...reviewDetectionsQueryOptions,
    // Keep polling only while a task is still producing its AI result. The next
    // response replaces this disabled placeholder with the reviewable result.
    refetchInterval: (query) => (
      query.state.data?.some((result) => result.review_status === "detecting")
        ? 5_000
        : false
    )
  });
  const results = (resultsQuery.data ?? []).filter((result) => (
    result.review_status === "detecting"
    || result.review_status === "pending_review"
    || result.review_status === "reviewed"
    || result.review_status === "completed"
  ));

  return (
    <div className="review-workbench-page management-list-page">
      <div className="project-workspace">
        <section className="project-hero">
          <div className="management-page-title">
            <ClipboardCheck aria-hidden="true" className="management-page-title-icon" />
            <h1>审核工作台</h1>
          </div>
          <div className="project-hero-action standalone-management-actions">
            <Link className="button secondary report-back-button standalone-management-home-link" to="/">
              <ArrowLeft aria-hidden="true" />
              <span>返回首页</span>
            </Link>
          </div>
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
                          <div className="table-actions">
                            <Link
                              className="table-action"
                              state={{
                                backLabel: "返回审核工作台",
                                backTo: "/review",
                                projectTitle: result.project_name
                              }}
                              to={`/review/detections/${result.project_id}/model`}
                            >
                              <Box aria-hidden="true" />三维模型
                            </Link>
                            {action.disabled ? (
                              <span className="table-action is-disabled">
                                <Icon aria-hidden="true" />{action.label}
                              </span>
                            ) : (
                              <Link
                                className="table-action table-action-review"
                                to={action.to}
                              >
                                <Icon aria-hidden="true" />{action.label}
                              </Link>
                            )}
                            {(result.review_status === "reviewed" || result.review_status === "completed")
                              && result.report_id ? (
                                <Link
                                  className="table-action"
                                  to={`/detections/results/${result.report_id}`}
                                >
                                  <Eye aria-hidden="true" />查看结果
                                </Link>
                              ) : null}
                          </div>
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
        </section>
      </div>
    </div>
  );
}
