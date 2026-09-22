import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { reviewDetectionsQueryOptions } from "@/api/review";
import { ListPagination } from "@/components/ListPagination";
import { WorkbenchNameSearch } from "@/components/WorkbenchNameSearch";
import { WorkbenchResultTable } from "@/components/WorkbenchResultTable";
import type {
  ReviewDetectionListItem,
  ReviewDetectionStatus
} from "@/types/review";
import { formatDateTime } from "@/utils/projectDisplay";

const statusMeta: Record<ReviewDetectionStatus, { className: string; label: string }> = {
  detecting: { className: "status-tag detecting", label: "AI 检测中" },
  pending_review: { className: "primary-action-button", label: "待推送" },
  reviewed: { className: "back-cancel-button", label: "已推送" },
  completed: { className: "back-cancel-button", label: "已推送" },
  failed: { className: "status-tag danger", label: "检测失败" }
};

const PAGE_SIZE = 10;

export function ReviewProjectListPage() {
  const navigate = useNavigate();
  const [currentPage, setCurrentPage] = useState(1);
  const [projectNameSearch, setProjectNameSearch] = useState("");
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
  const matchingResults = useMemo(() => {
    const search = projectNameSearch.trim().toLocaleLowerCase();
    if (!search) return results;
    return results.filter((result) => result.project_name.toLocaleLowerCase().includes(search));
  }, [projectNameSearch, results]);
  const workbenchResults = useMemo(() => matchingResults.map((result) => ({
    ...result,
    first_photo_url: null,
    generated_at: result.created_at,
    title: result.project_name
  })), [matchingResults]);
  const totalPages = Math.max(1, Math.ceil(workbenchResults.length / PAGE_SIZE));
  const visiblePage = Math.min(currentPage, totalPages);
  const paginatedResults = useMemo(() => {
    const startIndex = (visiblePage - 1) * PAGE_SIZE;
    return workbenchResults.slice(startIndex, startIndex + PAGE_SIZE);
  }, [visiblePage, workbenchResults]);

  return (
    <div className="review-workbench-page management-list-page">
      <div className="project-workspace">
        {resultsQuery.isError ? (
          <p className="project-list-error">检测结果加载失败，请稍后重试。</p>
        ) : null}

        <section className="project-list-panel workbench-result-list-panel" aria-label="检测结果列表">
          {results.length ? <WorkbenchNameSearch
            label="搜索检测名称"
            value={projectNameSearch}
            onChange={(value) => {
              setProjectNameSearch(value);
              setCurrentPage(1);
            }}
          /> : null}
          <div className="project-table-wrap project-workbench-table-wrap">
            {resultsQuery.isLoading ? (
              <div className="project-empty"><strong>正在加载检测结果…</strong></div>
            ) : results.length && workbenchResults.length ? (
              <WorkbenchResultTable
                columnLabel="检测名称"
                completionTimeLabel="更新时间"
                detectionTypeLabel="当前状态"
                getKey={(result) => result.id}
                items={paginatedResults}
                onOpen={(result) => navigate(`/review/detections/${result.id}`)}
                openOnRowClick
                renderCompletionTime={(result) => (
                  <time dateTime={result.updated_at}>{formatDateTime(result.updated_at)}</time>
                )}
                renderDetectionType={(result) => (
                  <span className={statusMeta[result.review_status].className}>
                    {statusMeta[result.review_status].label}
                  </span>
                )}
                renderLeadingIndicator={(result) => result.generate_building_model ? (
                  <img alt="" aria-hidden="true" src="/icons/action-cube.png" />
                ) : null}
                renderTitleAccessory={(result) => (
                  <time dateTime={result.created_at}>{formatDateTime(result.created_at)}</time>
                )}
                showThumbnail={false}
                titleAccessoryLabel="创建时间"
              />
            ) : results.length ? (
              <div className="project-empty project-search-empty-state">
                <strong>未找到匹配的检测项目</strong>
                <span>请尝试其他检测名称。</span>
              </div>
            ) : (
              <div className="project-empty">
                <strong>暂无检测结果</strong>
                <span>项目完成 AI 检测后会在这里显示一条记录。</span>
              </div>
            )}
          </div>
          <ListPagination
            currentPage={visiblePage}
            onPageChange={setCurrentPage}
            pageSize={PAGE_SIZE}
            totalItems={workbenchResults.length}
          />
        </section>
      </div>
    </div>
  );
}
