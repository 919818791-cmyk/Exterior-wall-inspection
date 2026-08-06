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
  renderDetectionDescription?: (item: T) => ReactNode;
  renderTitleAccessory?: (item: T) => ReactNode;
}

export function WorkbenchResultTable<T extends WorkbenchResultListItem>({
  columnLabel = "结果名称",
  getAriaLabel,
  getKey,
  items,
  onOpen,
  renderDetectionDescription,
  renderTitleAccessory
}: WorkbenchResultTableProps<T>) {
  return (
    <table className="project-table project-workbench-table workbench-result-table">
      <colgroup>
        <col className="project-folder-col" />
        <col className="workbench-result-name-col" />
        {renderTitleAccessory ? <col className="workbench-result-status-col" /> : null}
        {renderDetectionDescription ? <col className="workbench-result-description-col" /> : null}
      </colgroup>
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
                folderImageSrc="/bg-folder.png"
                title={item.title}
              />
            </td>
            <td className="report-name-column list-primary-column" data-label={columnLabel}>
              <span className="result-name-content workbench-list-copy">
                <span className="project-name-line workbench-list-title-line">
                  <strong className="project-name workbench-list-title">{item.title}</strong>
                </span>
                <small className="result-generated-time workbench-list-meta">
                  {formatDateTime(item.generated_at)} · {item.photo_count}张照片
                </small>
              </span>
            </td>
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

export function WorkbenchDefectSummary({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((sum, count) => sum + Math.max(0, count), 0);
  return <p>共{total}处缺陷</p>;
}
