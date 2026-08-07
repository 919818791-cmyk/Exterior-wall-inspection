import type { ReactNode } from "react";

import { ResultFolderThumbnail } from "@/components/ResultFolderThumbnail";
import { formatDateTime } from "@/utils/projectDisplay";

interface WorkbenchResultListItem {
  first_photo_url: string | null;
  generated_at: string;
  photo_count: number;
  title: string;
}

interface WorkbenchResultTableProps<T extends WorkbenchResultListItem> {
  columnLabel?: string;
  getAriaLabel: (item: T) => string;
  getKey: (item: T) => string;
  items: T[];
  onOpen: (item: T) => void;
  renderDetectionProgress?: (item: T) => ReactNode;
  renderDetectionDescription?: (item: T) => ReactNode;
  renderTitleAccessory?: (item: T) => ReactNode;
}

export function WorkbenchResultTable<T extends WorkbenchResultListItem>({
  columnLabel = "结果名称",
  getAriaLabel,
  getKey,
  items,
  onOpen,
  renderDetectionProgress,
  renderDetectionDescription,
  renderTitleAccessory
}: WorkbenchResultTableProps<T>) {
  return (
    <table className="project-table project-workbench-table workbench-result-table">
      <colgroup>
        <col className="project-folder-col" />
        <col className="workbench-result-name-col" />
        <col className="workbench-result-created-at-col" />
        <col className="workbench-result-photo-count-col" />
        {renderDetectionProgress ? <col className="workbench-result-progress-col" /> : null}
        {renderTitleAccessory ? <col className="workbench-result-status-col" /> : null}
        {renderDetectionDescription ? <col className="workbench-result-description-col" /> : null}
      </colgroup>
      <thead>
        <tr>
          <th aria-label="照片" scope="col" />
          <th className="workbench-result-name-heading" scope="col">{columnLabel}</th>
          <th scope="col">创建时间</th>
          <th scope="col">照片数量</th>
          {renderDetectionProgress ? <th scope="col">检测进度</th> : null}
          {renderTitleAccessory ? <th scope="col">状态</th> : null}
          {renderDetectionDescription ? <th scope="col">缺陷摘要</th> : null}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr
            aria-label={getAriaLabel(item)}
            className="workbench-result-row project-clickable-row"
            key={getKey(item)}
            onClick={() => onOpen(item)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onOpen(item);
            }}
            role="link"
            tabIndex={0}
          >
            <td className="result-folder-column">
              <ResultFolderThumbnail
                firstPhotoUrl={item.first_photo_url}
                folderImageSrc="/images/WJJ.png"
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
            <td className="workbench-result-created-at-column result-generated-time" data-label="创建时间">
              <time dateTime={item.generated_at}>{formatDateTime(item.generated_at)}</time>
            </td>
            <td className="workbench-result-photo-count-column" data-label="照片数量">
              {item.photo_count} 张
            </td>
            {renderDetectionProgress ? (
              <td className="workbench-result-progress-column" data-label="检测进度">
                {renderDetectionProgress(item)}
              </td>
            ) : null}
            {renderTitleAccessory ? (
              <td className="workbench-result-status-column">
                {renderTitleAccessory(item)}
              </td>
            ) : null}
            {renderDetectionDescription ? (
              <td className="trial-report-description workbench-result-description-column">
                {renderDetectionDescription(item)}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function WorkbenchDefectSummary({ counts, placeholder }: { counts: Record<string, number>; placeholder?: string }) {
  if (placeholder) return <p>{placeholder}</p>;

  const total = Object.values(counts).reduce((sum, count) => sum + Math.max(0, count), 0);
  return <p>共{total}处</p>;
}
