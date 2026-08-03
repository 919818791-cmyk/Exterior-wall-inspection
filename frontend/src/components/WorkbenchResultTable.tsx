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
  renderTitleAccessory?: (item: T) => ReactNode;
}

export function WorkbenchResultTable<T extends WorkbenchResultListItem>({
  columnLabel = "结果名称",
  getAriaLabel,
  getKey,
  items,
  onOpen,
  renderTitleAccessory
}: WorkbenchResultTableProps<T>) {
  return (
    <table className="project-table project-workbench-table workbench-result-table">
      <colgroup>
        <col className="project-folder-col" />
        <col className="workbench-result-name-col" />
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
                folderImageSrc="/images/project-folder-z.png"
                title={item.title}
              />
            </td>
            <td className="report-name-column list-primary-column" data-label={columnLabel}>
              <span className="result-name-content workbench-list-copy">
                <span className="project-name-line workbench-list-title-line">
                  <strong className="project-name workbench-list-title">{item.title}</strong>
                  {renderTitleAccessory?.(item)}
                </span>
                <small className="result-generated-time workbench-list-meta">
                  {formatDateTime(item.generated_at)} · {item.photo_count}张照片
                </small>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
