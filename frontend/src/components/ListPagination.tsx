import { ChevronLeft, ChevronRight } from "lucide-react";

interface ListPaginationProps {
  ariaLabel?: string;
  className?: string;
  currentPage: number;
  itemUnit?: string;
  onPageChange: (page: number) => void;
  pageSize: number;
  showWhenEmpty?: boolean;
  totalItems: number;
}

export function ListPagination({
  ariaLabel = "列表分页",
  className = "",
  currentPage,
  itemUnit = "条",
  onPageChange,
  pageSize,
  showWhenEmpty = false,
  totalItems
}: ListPaginationProps) {
  if (totalItems === 0 && !showWhenEmpty) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const pages = visiblePages(currentPage, totalPages);

  return (
    <nav
      className={`project-pagination workbench-list-pagination ${className}`.trim()}
      aria-label={ariaLabel}
    >
      {totalItems > 0 ? <span>共 {totalItems} {itemUnit}</span> : null}
      <div>
        <button
          aria-label="上一页"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          type="button"
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        {pages.map((page, index) => page === null
          ? <span aria-hidden="true" className="pagination-ellipsis" key={`ellipsis-${index}`}>…</span>
          : <button
              aria-current={page === currentPage ? "page" : undefined}
              aria-label={`第 ${page} 页`}
              className={page === currentPage ? "current-page" : undefined}
              key={page}
              onClick={() => onPageChange(page)}
              type="button"
            >
              {page}
            </button>
        )}
        <button
          aria-label="下一页"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          type="button"
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

function visiblePages(currentPage: number, totalPages: number): Array<number | null> {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (currentPage <= 3) return [1, 2, 3, 4, null, totalPages];
  if (currentPage >= totalPages - 2) return [1, null, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, null, currentPage - 1, currentPage, currentPage + 1, null, totalPages];
}
