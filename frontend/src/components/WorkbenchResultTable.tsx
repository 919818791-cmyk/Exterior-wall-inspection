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
  columnLabel?: string;
  completionTimeLabel?: string;
  detectionTypeLabel?: string;
  getKey: (item: T) => string;
  items: T[];
  onOpen: (item: T) => void;
  openOnRowClick?: boolean;
  renderCompletionTime?: (item: T) => ReactNode;
  renderDetectionDescription?: (item: T) => ReactNode;
  renderDetectionType?: (item: T) => ReactNode;
  renderLeadingIndicator?: (item: T) => ReactNode;
  renderTrailingIndicator?: (item: T) => ReactNode;
  renderTitleAccessory?: (item: T) => ReactNode;
  showThumbnail?: boolean;
  indicatorLabel?: string;
  titleAccessoryLabel?: string;
}

export function WorkbenchResultTable<T extends WorkbenchResultListItem>({
  columnLabel = "检测名称",
  completionTimeLabel = "完成时间",
  detectionTypeLabel = "检测类型",
  getKey,
  items,
  onOpen,
  openOnRowClick = false,
  renderCompletionTime,
  renderDetectionDescription,
  renderDetectionType,
  renderLeadingIndicator,
  renderTrailingIndicator,
  renderTitleAccessory,
  showThumbnail = true,
  indicatorLabel = "三维模型",
  titleAccessoryLabel = "状态"
}: WorkbenchResultTableProps<T>) {
  const hasLeadingContent = showThumbnail;
  const hasLeadingIndicator = Boolean(renderLeadingIndicator);
  const hasTrailingIndicator = Boolean(renderTrailingIndicator);
  const rowsOpenOnClick = openOnRowClick;

  return (
    <table className="project-table project-workbench-table workbench-result-table">
      <colgroup>
        {hasLeadingContent ? <col className="project-folder-col" /> : null}
        {hasLeadingIndicator ? <col className="workbench-result-indicator-col" /> : null}
        <col className="workbench-result-name-col" />
        {renderTitleAccessory ? <col className="workbench-result-status-col" /> : null}
        {renderDetectionType ? <col className="workbench-result-detection-type-col" /> : null}
        {renderCompletionTime ? <col className="workbench-result-completion-time-col" /> : null}
        {renderDetectionDescription ? <col className="workbench-result-description-col" /> : null}
        {hasTrailingIndicator ? <col className="workbench-result-indicator-col" /> : null}
      </colgroup>
      <thead>
        <tr>
          {hasLeadingContent ? (
            <th aria-label="照片" scope="col" />
          ) : null}
          {hasLeadingIndicator ? (
            <th
              aria-label={indicatorLabel}
              className="workbench-result-indicator-heading"
              scope="col"
            />
          ) : null}
          <th className="workbench-result-name-heading" scope="col">{columnLabel}</th>
          {renderTitleAccessory ? <th className="workbench-result-status-heading" scope="col">{titleAccessoryLabel}</th> : null}
          {renderDetectionType ? <th className="workbench-result-detection-type-heading" scope="col">{detectionTypeLabel}</th> : null}
          {renderCompletionTime ? <th className="workbench-result-completion-time-heading" scope="col">{completionTimeLabel}</th> : null}
          {renderDetectionDescription ? <th className="workbench-result-description-heading" scope="col">缺陷摘要</th> : null}
          {hasTrailingIndicator ? (
            <th
              aria-label={indicatorLabel}
              className="workbench-result-indicator-heading"
              scope="col"
            />
          ) : null}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
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
            {hasLeadingContent ? (
              <td className="result-folder-column">
                <ResultFolderThumbnail
                  firstPhotoUrl={item.first_photo_url}
                  photoCount={item.photo_count}
                  title={item.title}
                />
              </td>
            ) : null}
            {hasLeadingIndicator ? (
              <td className="workbench-result-indicator-column">
                {renderLeadingIndicator?.(item)}
              </td>
            ) : null}
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
              <td className="workbench-result-detection-type-column" data-label={detectionTypeLabel}>
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
            {hasTrailingIndicator ? (
              <td className="workbench-result-indicator-column">
                {renderTrailingIndicator?.(item)}
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
      ? visibleEntries.map((entry) => `${entry.label}·${entry.count}`).join("、")
      : variant === "compact" ? <span className="workbench-defect-summary-empty">--</span>
      : details ? <span className="workbench-defect-summary-details">{details}</span> : null}
  </p>;
}

const detectionTypeLabels: Record<string, string> = {
  crack: "裂缝",
  spalling: "脱落",
  peeling: "起皮",
  damage: "面板破损",
  hollow: "空鼓",
  moisture: "潮湿"
};

export function WorkbenchDetectionTypes({ types }: { types: string[] }) {
  if (!types.length) return <span>--</span>;

  return <span>{types.map((type) => detectionTypeLabels[type] ?? type).join("、")}</span>;
}
