import { useQuery } from "@tanstack/react-query";
import { Edit3 } from "lucide-react";
import { Link } from "react-router-dom";

import { annotationResultsQueryOptions } from "@/api/annotationManagement";
import { ResultFolderThumbnail } from "@/components/ResultFolderThumbnail";
import type { AnnotationResultListItem } from "@/types/annotationManagement";
import { formatDateTime } from "@/utils/projectDisplay";

export function AnnotationManagementPage() {
  const resultsQuery = useQuery(annotationResultsQueryOptions);
  const results = resultsQuery.data ?? [];

  return (
    <div className="annotation-management-page management-list-page">
      <div className="project-workspace">
        <section className="project-hero">
          <div className="management-page-title">
            <Edit3 aria-hidden="true" className="management-page-title-icon" />
            <h1>标注管理</h1>
          </div>
        </section>

        <div className="project-workbench-content-panel">
          {resultsQuery.isError ? (
            <p className="project-list-error">标注结果加载失败，请稍后重试。</p>
          ) : null}

          <section className="project-list-panel" aria-label="标注结果列表">
            <div className="project-table-wrap project-workbench-table-wrap">
              {resultsQuery.isLoading ? (
                <div className="project-empty"><strong>正在加载检测结果…</strong></div>
              ) : results.length ? (
                <table className="project-table project-workbench-table">
                  <tbody>
                    {results.map((result) => <AnnotationResultRow key={`${result.source_type}:${result.id}`} result={result} />)}
                  </tbody>
                </table>
              ) : (
                <div className="project-empty project-workbench-empty">
                  <strong>暂无可标注的检测结果</strong>
                  <span>正式项目结果和简易检测归档会在这里统一展示。</span>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function AnnotationResultRow({ result }: { result: AnnotationResultListItem }) {
  const query = new URLSearchParams({ source_type: result.source_type });
  return (
    <tr>
      <td className="result-folder-column" data-label="首张照片">
        <ResultFolderThumbnail firstPhotoUrl={result.first_photo_url} title={result.title} />
      </td>
      <td className="report-name-column list-primary-column" data-label="结果名称">
        <span className="result-name-content">
          <strong>{result.title}</strong>
          <small className="result-generated-time">{formatDateTime(result.generated_at)}</small>
        </span>
      </td>
      <td className="report-count-column" data-label="照片数量">{result.photo_count} 张</td>
      <td className="list-action-column" data-label="操作">
        <Link className="table-action table-action-result" to={`/annotation-management/${result.id}?${query.toString()}`}>
          <Edit3 aria-hidden="true" />编辑标注
        </Link>
      </td>
    </tr>
  );
}
