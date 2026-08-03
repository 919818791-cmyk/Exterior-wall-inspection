import { useQuery } from "@tanstack/react-query";
import { SquarePen } from "lucide-react";
import { Link } from "react-router-dom";

import { annotationResultsQueryOptions } from "@/api/annotationManagement";
import { formatDateTime } from "@/utils/projectDisplay";

const sourceLabels = {
  formal: "正式项目",
  trial: "简易检测"
} as const;

export function AnnotationManagementPage() {
  const resultsQuery = useQuery(annotationResultsQueryOptions);
  const results = resultsQuery.data ?? [];

  return (
    <div className="annotation-management-page management-list-page">
      <div className="project-workspace">
        <section className="project-hero">
          <div className="management-page-title">
            <SquarePen aria-hidden="true" className="management-page-title-icon" />
            <h1>标注管理</h1>
          </div>
        </section>

        {resultsQuery.isError ? (
          <p className="project-list-error">标注结果加载失败，请稍后重试。</p>
        ) : null}

        <section className="project-list-panel" aria-label="标注结果列表">
          <div className="project-table-wrap">
            {resultsQuery.isLoading ? (
              <div className="project-empty"><strong>正在加载检测结果…</strong></div>
            ) : results.length ? (
              <table className="project-table">
                <thead>
                  <tr>
                    <th>检测结果</th>
                    <th>照片</th>
                    <th>结果来源</th>
                    <th>AI 识别</th>
                    <th>更新时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((result) => {
                    const query = new URLSearchParams({ source_type: result.source_type });
                    return (
                      <tr key={`${result.source_type}:${result.id}`}>
                        <td data-label="检测结果"><strong>{result.title}</strong></td>
                        <td data-label="照片">
                          <strong>{result.photo_count} 张</strong>
                          <small>检测照片</small>
                        </td>
                        <td data-label="结果来源">{sourceLabels[result.source_type]}</td>
                        <td data-label="AI 识别">{result.total_defects} 项</td>
                        <td data-label="更新时间">{formatDateTime(result.updated_at)}</td>
                        <td data-label="操作">
                          <Link
                            aria-label={`编辑标注：${result.title}`}
                            className="table-action table-action-review"
                            to={`/annotation-management/${result.id}?${query.toString()}`}
                          >
                            <SquarePen aria-hidden="true" />编辑标注
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="project-empty">
                <strong>暂无可标注的检测结果</strong>
                <span>正式项目结果和简易检测归档会在这里统一展示。</span>
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
