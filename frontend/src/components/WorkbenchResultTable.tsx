import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { ResultFolderThumbnail } from "@/components/ResultFolderThumbnail";
import { trialDefectDisplayFromModel } from "@/utils/trialDefectDisplay";

interface WorkbenchResultListItem {
  first_photo_url: string | null;
  generated_at: string;
  photo_count: number;
  title: string;
}

interface WorkbenchResultTableProps<T extends WorkbenchResultListItem> {
  canDelete?: (item: T) => boolean;
  canRename?: (item: T) => boolean;
  columnLabel?: string;
  completionTimeLabel?: string;
  getDeleteDisabledReason?: (item: T) => string;
  getActionLabel?: (item: T) => string;
  getKey: (item: T) => string;
  items: T[];
  onDelete?: (item: T) => void;
  onOpen: (item: T) => void;
  onRename?: (item: T) => void;
  renderCompletionTime?: (item: T) => ReactNode;
  renderDetectionDescription?: (item: T) => ReactNode;
  renderDetectionType?: (item: T) => ReactNode;
  renderTitleAccessory?: (item: T) => ReactNode;
}

export function WorkbenchResultTable<T extends WorkbenchResultListItem>({
  canDelete,
  canRename,
  columnLabel = "检测名称",
  completionTimeLabel = "完成时间",
  getDeleteDisabledReason,
  getActionLabel,
  getKey,
  items,
  onDelete,
  onOpen,
  onRename,
  renderCompletionTime,
  renderDetectionDescription,
  renderDetectionType,
  renderTitleAccessory
}: WorkbenchResultTableProps<T>) {
  const hasActions = Boolean(getActionLabel || onRename || onDelete);

  return (
    <table className="project-table project-workbench-table workbench-result-table">
      <colgroup>
        <col className="project-folder-col" />
        <col className="workbench-result-name-col" />
        {renderTitleAccessory ? <col className="workbench-result-status-col" /> : null}
        {renderDetectionType ? <col className="workbench-result-detection-type-col" /> : null}
        {renderCompletionTime ? <col className="workbench-result-completion-time-col" /> : null}
        {renderDetectionDescription ? <col className="workbench-result-description-col" /> : null}
        {hasActions ? <col className="workbench-result-action-col" /> : null}
      </colgroup>
      <thead>
        <tr>
          <th aria-label="照片" scope="col" />
          <th className="workbench-result-name-heading" scope="col">{columnLabel}</th>
          {renderTitleAccessory ? <th className="workbench-result-status-heading" scope="col">状态</th> : null}
          {renderDetectionType ? <th className="workbench-result-detection-type-heading" scope="col">检测类型</th> : null}
          {renderCompletionTime ? <th className="workbench-result-completion-time-heading" scope="col">{completionTimeLabel}</th> : null}
          {renderDetectionDescription ? <th className="workbench-result-description-heading" scope="col">缺陷摘要</th> : null}
          {hasActions ? <th className="workbench-result-action-heading" scope="col">操作</th> : null}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const actionLabel = getActionLabel?.(item);
          const deleteEnabled = canDelete?.(item) ?? true;
          const renameEnabled = canRename?.(item) ?? true;
          const deleteDisabledReason = deleteEnabled ? undefined : getDeleteDisabledReason?.(item);

          return <tr className="workbench-result-row" key={getKey(item)}>
            <td className="result-folder-column">
              <ResultFolderThumbnail
                firstPhotoUrl={item.first_photo_url}
                photoCount={item.photo_count}
                title={item.title}
              />
            </td>
            <td className="report-name-column list-primary-column" data-label={columnLabel}>
              <span className="result-name-content workbench-list-copy">
                <span className="project-name-line workbench-list-title-line">
                  <strong className="project-name workbench-list-title">{item.title}</strong>
                </span>
              </span>
            </td>
            {renderTitleAccessory ? (
              <td className="workbench-result-status-column" data-label="状态">
                {renderTitleAccessory(item)}
              </td>
            ) : null}
            {renderDetectionType ? (
              <td className="workbench-result-detection-type-column" data-label="检测类型">
                {renderDetectionType(item)}
              </td>
            ) : null}
            {renderCompletionTime ? (
              <td className="workbench-result-completion-time-column" data-label={completionTimeLabel}>
                {renderCompletionTime(item)}
              </td>
            ) : null}
            {renderDetectionDescription ? (
              <td className="trial-report-description workbench-result-description-column" data-label="缺陷摘要">
                {renderDetectionDescription(item)}
              </td>
            ) : null}
            {hasActions ? (
              <td className="workbench-result-action-column" data-label="操作">
                <div className="workbench-result-actions">
                  {actionLabel ? (
                    <button
                      aria-label={`${actionLabel}：${item.title}`}
                      className="workbench-result-action-button"
                      type="button"
                      onClick={() => onOpen(item)}
                    >
                      {actionLabel}
                    </button>
                  ) : null}
                  {onRename || onDelete ? (
                    <details
                      className="workbench-result-more"
                      onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                          event.currentTarget.removeAttribute("open");
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Escape") return;
                        event.currentTarget.removeAttribute("open");
                        event.currentTarget.querySelector<HTMLElement>("summary")?.focus();
                      }}
                    >
                      <summary aria-label={`更多操作：${item.title}`} title="更多操作">
                        <Ellipsis aria-hidden="true" />
                      </summary>
                      <div className="workbench-result-more-menu" role="menu">
                        {onRename && renameEnabled ? (
                          <button
                            role="menuitem"
                            type="button"
                            onClick={(event) => {
                              event.currentTarget.closest("details")?.removeAttribute("open");
                              onRename(item);
                            }}
                          >
                            <Pencil aria-hidden="true" />重命名
                          </button>
                        ) : null}
                        {onDelete ? (
                          <button
                            className="danger"
                            disabled={!deleteEnabled}
                            role="menuitem"
                            title={deleteDisabledReason}
                            type="button"
                            onClick={(event) => {
                              event.currentTarget.closest("details")?.removeAttribute("open");
                              onDelete(item);
                            }}
                          >
                            <Trash2 aria-hidden="true" />删除
                          </button>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                </div>
              </td>
            ) : null}
          </tr>;
        })}
      </tbody>
    </table>
  );
}

type WorkbenchDefectSummaryVariant = "stacked" | "compact";

interface WorkbenchDefectSummaryProps {
  counts: Record<string, number>;
  placeholder?: string;
  variant?: WorkbenchDefectSummaryVariant;
}

const MAX_VISIBLE_DEFECT_TYPES = 3;

export function WorkbenchDefectSummary({
  counts,
  placeholder,
  variant = "stacked"
}: WorkbenchDefectSummaryProps) {
  if (placeholder) return <p className="workbench-defect-summary is-placeholder">{placeholder}</p>;

  const mergedCounts = new Map<string, number>();
  Object.entries(counts).forEach(([type, rawCount]) => {
    const count = Number.isFinite(rawCount) ? Math.max(0, rawCount) : 0;
    if (!count) return;
    const label = trialDefectDisplayFromModel(type).label;
    mergedCounts.set(label, (mergedCounts.get(label) ?? 0) + count);
  });

  const entries = Array.from(mergedCounts, ([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count);
  const visibleEntries = entries.length > MAX_VISIBLE_DEFECT_TYPES
    ? [
        ...entries.slice(0, MAX_VISIBLE_DEFECT_TYPES - 1),
        {
          label: "其他",
          count: entries.slice(MAX_VISIBLE_DEFECT_TYPES - 1).reduce((sum, entry) => sum + entry.count, 0)
        }
      ]
    : entries;
  const details = visibleEntries.map((entry) => `${entry.label}${entry.count}`).join("、");
  const accessibleSummary = details || "无缺陷";

  return <p
    aria-label={accessibleSummary}
    className={`workbench-defect-summary is-${variant}`}
  >
    {variant === "compact" && visibleEntries.length
      ? visibleEntries.map((entry) => (
          <span className="workbench-defect-summary-detail-pill" key={entry.label}>
            {entry.label}·{entry.count}
          </span>
        ))
      : variant === "compact" ? <span className="workbench-defect-summary-empty">--</span>
      : details ? <span className="workbench-defect-summary-details">{details}</span> : null}
  </p>;
}

const detectionTypeLabels: Record<string, string> = {
  crack: "裂缝",
  spalling: "剥落",
  hollow: "空鼓",
  moisture: "潮湿"
};

export function WorkbenchDetectionTypes({ types }: { types: string[] }) {
  if (!types.length) return <span>--</span>;

  return <span>{types.map((type) => detectionTypeLabels[type] ?? type).join("、")}</span>;
}
