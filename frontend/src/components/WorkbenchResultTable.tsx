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
  getLeadingActionLabel?: (item: T) => string;
  getKey: (item: T) => string;
  items: T[];
  onDelete?: (item: T) => void;
  onLeadingAction?: (item: T) => void;
  onOpen: (item: T) => void;
  openOnRowClick?: boolean;
  onRename?: (item: T) => void;
  renderCompletionTime?: (item: T) => ReactNode;
  renderDetectionDescription?: (item: T) => ReactNode;
  renderDetectionType?: (item: T) => ReactNode;
  renderTitleAccessory?: (item: T) => ReactNode;
  titleAccessoryLabel?: string;
}

export function WorkbenchResultTable<T extends WorkbenchResultListItem>({
  canDelete,
  canRename,
  columnLabel = "检测名称",
  completionTimeLabel = "完成时间",
  getDeleteDisabledReason,
  getLeadingActionLabel,
  getKey,
  items,
  onDelete,
  onLeadingAction,
  onOpen,
  openOnRowClick = false,
  onRename,
  renderCompletionTime,
  renderDetectionDescription,
  renderDetectionType,
  renderTitleAccessory,
  titleAccessoryLabel = "状态"
}: WorkbenchResultTableProps<T>) {
  const hasActions = Boolean((getLeadingActionLabel && onLeadingAction) || onRename || onDelete);
  const rowsOpenOnClick = openOnRowClick;

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
          {renderTitleAccessory ? <th className="workbench-result-status-heading" scope="col">{titleAccessoryLabel}</th> : null}
          {renderDetectionType ? <th className="workbench-result-detection-type-heading" scope="col">检测类型</th> : null}
          {renderCompletionTime ? <th className="workbench-result-completion-time-heading" scope="col">{completionTimeLabel}</th> : null}
          {renderDetectionDescription ? <th className="workbench-result-description-heading" scope="col">缺陷摘要</th> : null}
          {hasActions ? <th className="workbench-result-action-heading" scope="col">操作</th> : null}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const leadingActionLabel = getLeadingActionLabel?.(item);
          const leadingActionIcon = leadingActionLabel === "3D模型"
            ? <img alt="" aria-hidden="true" className="workbench-solid-action-icon" src="/icons/action-cube.png" />
            : null;
          const deleteEnabled = canDelete?.(item) ?? true;
          const renameEnabled = canRename?.(item) ?? true;
          const deleteDisabledReason = deleteEnabled ? undefined : getDeleteDisabledReason?.(item);

          return <tr
            aria-label={rowsOpenOnClick ? `打开：${item.title}` : undefined}
            className={`workbench-result-row${rowsOpenOnClick ? " is-row-openable" : ""}`}
            key={getKey(item)}
            tabIndex={rowsOpenOnClick ? 0 : undefined}
            onClick={rowsOpenOnClick ? (event) => {
              const target = event.target;
              if (target instanceof Element && target.closest("button, a, input, select, textarea, summary, details, [role='menuitem']")) return;
              onOpen(item);
            } : undefined}
            onKeyDown={rowsOpenOnClick ? (event) => {
              if (event.key !== "Enter") return;
              const target = event.target;
              if (target instanceof Element && target.closest("button, a, input, select, textarea, summary, details, [role='menuitem']")) return;
              event.preventDefault();
              onOpen(item);
            } : undefined}
          >
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
              <td className="workbench-result-status-column" data-label={titleAccessoryLabel}>
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
                  {leadingActionLabel && onLeadingAction ? (
                    <button
                      aria-label={`${leadingActionLabel}：${item.title}`}
                      className={`workbench-result-action-button workbench-result-leading-action-button${leadingActionIcon ? " workbench-result-icon-button" : ""}`}
                      title={`${leadingActionLabel}：${item.title}`}
                      type="button"
                      onClick={() => onLeadingAction(item)}
                    >
                      {leadingActionIcon ?? leadingActionLabel}
                    </button>
                  ) : null}
                  {onRename && renameEnabled ? (
                    <button
                      aria-label={`重命名：${item.title}`}
                      className="workbench-result-action-button workbench-result-icon-button"
                      title={`重命名：${item.title}`}
                      type="button"
                      onClick={() => onRename(item)}
                    >
                      <img alt="" aria-hidden="true" className="workbench-solid-action-icon" src="/icons/action-pencil.png" />
                    </button>
                  ) : null}
                  {onDelete ? (
                    <button
                      aria-label={`删除：${item.title}`}
                      className="workbench-result-action-button workbench-result-icon-button workbench-result-danger-action-button"
                      disabled={!deleteEnabled}
                      title={deleteEnabled ? `删除：${item.title}` : deleteDisabledReason}
                      type="button"
                      onClick={() => onDelete(item)}
                    >
                      <img alt="" aria-hidden="true" className="workbench-solid-action-icon" src="/icons/action-trash.png" />
                    </button>
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
