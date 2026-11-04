import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine, ArrowUpRight, ChevronLeft, ChevronRight, CircleAlert,
  ImageIcon, Images, LayoutGrid, List, LoaderCircle, Pencil, RotateCcw, Search, SlidersHorizontal, X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { exportPhotos, fetchPhotoSelection, photoLibraryQueryOptions, updatePhotoFacadeType } from "@/api/photoLibrary";
import { ListPagination } from "@/components/ListPagination";
import { PhotoDateRangeFilter } from "@/components/PhotoDateRangeFilter";
import { PhotoFacadeDialog } from "@/components/PhotoFacadeDialog";
import { useAuthStore } from "@/stores/useAuthStore";
import type { LibraryPhoto, PhotoLibraryFilters, PhotoResult } from "@/types/photoLibrary";
import type { DefectType, FacadeType } from "@/types/projects";
import { saveBlobAsFile } from "@/utils/download";
import { formatDateTime } from "@/utils/projectDisplay";
import { trialDefectDisplayFromType } from "@/utils/trialDefectDisplay";

const PAGE_SIZE = 24;
const INITIAL_FILTERS: PhotoLibraryFilters = {
  search: "", date_from: "", date_to: "", facade_type: "", defect_type: "", result: "",
  photo_type: "", source_type: "", sort: "newest"
};
const FACADE_LABELS: Record<FacadeType, string> = {
  tile: "饰面砖", coating: "涂饰", plaster: "抹灰", panel: "饰面板", curtain_wall: "幕墙", stone: "石材"
};
const RESULT_LABELS: Record<PhotoResult, string> = {
  defects: "检出缺陷", clear: "未检出缺陷", pending: "待检测", failed: "检测失败"
};
const DEFECT_TYPES: DefectType[] = ["crack", "spalling", "peeling", "damage", "moisture", "hollow"];

function formatFileSize(bytes: number | null) {
  if (bytes === null) return "大小未知";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function PhotoImage({ photo, original = false }: { photo: LibraryPhoto; original?: boolean }) {
  const [failed, setFailed] = useState(false);
  const url = original ? photo.preview_url : photo.thumbnail_url;
  useEffect(() => setFailed(false), [url]);
  return url && !failed
    ? <img alt={photo.original_filename} loading={original ? "eager" : "lazy"} onError={() => setFailed(true)} src={url} />
    : <span className="photo-library-image-fallback"><ImageIcon aria-hidden="true" /><span>照片暂时无法预览</span></span>;
}

function DefectTags({ photo }: { photo: LibraryPhoto }) {
  const counts = Object.entries(photo.defect_counts).filter(([, count]) => (count ?? 0) > 0);
  return <div className="photo-library-defect-tags">
    {counts.length ? counts.map(([type, count]) => <span key={type}>{trialDefectDisplayFromType(type).label}<b>{count}</b></span>)
      : <span className="photo-library-defect-placeholder">{photo.result === "clear" ? "本次检测未发现缺陷" : photo.result === "failed" ? "请前往检测项目查看原因" : "检测完成后显示缺陷结果"}</span>}
  </div>;
}

export function PhotoManagementPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [filters, setFilters] = useState<PhotoLibraryFilters>(INITIAL_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editingIds, setEditingIds] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const selectionVersion = useRef(0);
  const photosQuery = useQuery(photoLibraryQueryOptions(user, filters, page));
  const data = photosQuery.data;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const currentPage = data?.page ?? page;
  const allSelected = total > 0 && selected.size === total;
  const partiallySelected = selected.size > 0 && !allSelected;
  const hasFilters = Boolean(searchInput || filters.date_from || filters.date_to || filters.facade_type || filters.defect_type
    || filters.result || filters.photo_type || filters.source_type);
  const selectingAll = useMutation({
    mutationFn: fetchPhotoSelection,
    onError: (error: Error) => setNotice({ text: error.message, error: true })
  });
  const exportMutation = useMutation({
    mutationFn: exportPhotos,
    onMutate: () => setNotice(null),
    onSuccess: (blob, ids) => {
      saveBlobAsFile(blob, `检测照片_${new Date().toISOString().replace(/[:.]/g, "-")}.zip`);
      setNotice({ text: `已导出 ${ids.length} 张照片，压缩包内附照片清单和检测结果。`, error: false });
    },
    onError: (error: Error) => setNotice({ text: error.message, error: true })
  });
  const facadeMutation = useMutation({
    mutationFn: updatePhotoFacadeType,
    onMutate: () => setNotice(null),
    onSuccess: async () => {
      clearSelection();
      setEditingIds(null);
      setPreviewId(null);
      await queryClient.invalidateQueries({ queryKey: ["photo-library"] });
    }
  });

  const clearSelection = () => {
    selectionVersion.current += 1;
    setSelected(new Set());
  };
  const updateFilter = <K extends keyof PhotoLibraryFilters>(key: K, value: PhotoLibraryFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
    clearSelection();
    setNotice(null);
  };
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => current.search === searchInput.trim() ? current : { ...current, search: searchInput.trim() });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = partiallySelected;
  }, [partiallySelected]);

  function resetFilters() {
    setFilters(INITIAL_FILTERS);
    setSearchInput("");
    setPage(1);
    clearSelection();
    setNotice(null);
  }
  function togglePhoto(id: string) {
    selectionVersion.current += 1;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function selectAllMatching() {
    const version = ++selectionVersion.current;
    const result = await selectingAll.mutateAsync(filters).catch(() => null);
    if (!result || selectionVersion.current !== version) return;
    setSelected(new Set(result.photo_ids));
  }
  const previewIndex = items.findIndex((photo) => photo.id === previewId);
  const previewPhoto = items[previewIndex];
  const selectionBusy = photosQuery.isFetching || filters.search !== searchInput.trim()
    || selectingAll.isPending || exportMutation.isPending || facadeMutation.isPending;

  return <div className="photo-library-page">
    <section aria-label="照片检索" className="photo-library-filters">
      <div className="photo-library-filter-heading"><span><SlidersHorizontal aria-hidden="true" />筛选照片</span>
        {hasFilters ? <button className="photo-library-text-button" onClick={resetFilters} type="button"><RotateCcw aria-hidden="true" />重置筛选</button> : null}
      </div>
      <div className="photo-library-filter-fields">
        <label className="photo-library-search"><span>关键词</span><div><Search aria-hidden="true" /><input
          maxLength={128} onChange={(event) => { setSearchInput(event.target.value); setPage(1); clearSelection(); setNotice(null); }}
          placeholder="搜索照片名称、项目名称或编号" type="search" value={searchInput}
        /></div></label>
        <PhotoDateRangeFilter start={filters.date_from} end={filters.date_to} onChange={(date_from, date_to) => {
          setFilters((current) => ({ ...current, date_from, date_to }));
          setPage(1); clearSelection(); setNotice(null);
        }} />
        <label className="photo-library-field"><span>墙面类型</span><select onChange={(event) => updateFilter("facade_type", event.target.value as PhotoLibraryFilters["facade_type"])} value={filters.facade_type}>
          <option value="">全部墙面</option>{Object.entries(FACADE_LABELS).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
        </select></label>
        <label className="photo-library-field"><span>缺陷类型</span><select onChange={(event) => updateFilter("defect_type", event.target.value as PhotoLibraryFilters["defect_type"])} value={filters.defect_type}>
          <option value="">全部缺陷</option>{DEFECT_TYPES.map((type) => <option key={type} value={type}>{trialDefectDisplayFromType(type).label}</option>)}
        </select></label>
      </div>
      <button aria-expanded={advancedOpen} aria-controls="photo-library-advanced" className="photo-library-text-button photo-library-advanced-toggle" onClick={() => setAdvancedOpen((open) => !open)} type="button">
        {advancedOpen ? "收起更多筛选" : "更多筛选"}{!advancedOpen && (filters.photo_type || filters.source_type) ? " · 已启用" : ""}<ChevronRight aria-hidden="true" />
      </button>
      {advancedOpen ? <div className="photo-library-advanced" id="photo-library-advanced">
        <label className="photo-library-field"><span>照片类型</span><select onChange={(event) => updateFilter("photo_type", event.target.value as PhotoLibraryFilters["photo_type"])} value={filters.photo_type}>
          <option value="">全部类型</option><option value="visible">可见光</option><option value="thermal">热成像</option>
        </select></label>
        <label className="photo-library-field"><span>检测来源</span><select aria-label="检测来源" onChange={(event) => updateFilter("source_type", event.target.value as PhotoLibraryFilters["source_type"])} value={filters.source_type}>
          <option value="">全部来源</option><option value="professional">专业检测</option><option value="trial">快速体验</option>
        </select></label>
      </div> : null}
    </section>

    <section aria-label="检测照片" className="photo-library-results">
      <div className="photo-library-results-heading">
        <div aria-label="按检测结果分类" className="photo-library-result-tabs" role="group">
          {(["", "defects", "clear"] as const).map((result) => <button aria-pressed={filters.result === result} className={filters.result === result ? "is-active" : ""}
            key={result} onClick={() => updateFilter("result", result)} type="button">
            {result ? RESULT_LABELS[result] : "全部照片"}<span>{data?.summary[result || "total"] ?? "—"}</span>
          </button>)}
        </div>
        <div aria-label="照片展示方式" className="photo-library-view-switch" role="group">
          <button aria-label="网格视图" aria-pressed={view === "grid"} onClick={() => setView("grid")} type="button"><LayoutGrid aria-hidden="true" /></button>
          <button aria-label="列表视图" aria-pressed={view === "list"} onClick={() => setView("list")} type="button"><List aria-hidden="true" /></button>
        </div>
      </div>
      <div className="photo-library-selection-bar">
        <div><label className="photo-library-checkbox-label"><input checked={allSelected} disabled={!total || selectionBusy} onChange={() => allSelected ? clearSelection() : void selectAllMatching()} ref={selectAllRef} type="checkbox" />选择全部{selectingAll.isPending ? <LoaderCircle aria-hidden="true" className="photo-library-spinner" /> : null}</label>
          <span className="photo-library-selection-count" role="status">{selected.size ? <>已选 <strong>{selected.size}</strong> 张<span>（支持跨页选择）</span></> : <>共 <strong>{total}</strong> 张照片</>}</span>
          {selected.size ? <button className="photo-library-text-button" onClick={clearSelection} type="button">取消选择</button> : null}
        </div>
        <div><button className="primary-action-button" disabled={!selected.size || selectionBusy} onClick={() => exportMutation.mutate([...selected])} type="button">
          {exportMutation.isPending ? <LoaderCircle aria-hidden="true" className="photo-library-spinner" /> : <ArrowDownToLine aria-hidden="true" />}{exportMutation.isPending ? "正在打包…" : `批量导出${selected.size ? ` (${selected.size})` : ""}`}
        </button><button className="back-cancel-button" disabled={!selected.size || selectionBusy} onClick={() => {
          facadeMutation.reset(); setEditingIds([...selected]);
        }} type="button"><Pencil aria-hidden="true" />修改墙面类型</button></div>
      </div>
      {notice ? <div className={`photo-library-notice${notice.error ? " is-error" : ""}`} role={notice.error ? "alert" : "status"}>
        <CircleAlert aria-hidden="true" /><span>{notice.text}</span><button aria-label="关闭提示" onClick={() => setNotice(null)} type="button"><X aria-hidden="true" /></button>
      </div> : null}
      <div aria-busy={photosQuery.isFetching} className="photo-library-content">
        {photosQuery.isError ? <div className="project-empty" role="alert"><CircleAlert aria-hidden="true" /><strong>照片加载失败</strong><span>{photosQuery.error.message}</span><button className="back-cancel-button" onClick={() => void photosQuery.refetch()} type="button">重新加载</button></div>
          : photosQuery.isPending ? <div className="project-empty"><LoaderCircle aria-hidden="true" className="photo-library-spinner" /><strong>正在加载照片…</strong></div>
          : !items.length ? <div className="project-empty"><Images aria-hidden="true" /><strong>{hasFilters ? "未找到匹配的照片" : "还没有检测照片"}</strong><span>{hasFilters ? "试试其他关键词，或调整墙面类型和缺陷筛选。" : "上传到检测项目的照片会集中显示在这里。"}</span>
            {hasFilters ? <button className="back-cancel-button" onClick={resetFilters} type="button">清除筛选</button> : <Link className="primary-action-button" to="/detections/new">新建检测项目<ArrowUpRight aria-hidden="true" /></Link>}
          </div> : <div className={`photo-library-grid${view === "list" ? " is-list" : ""}`}>
            {items.map((photo) => <article className={`photo-library-card${selected.has(photo.id) ? " is-selected" : ""}`} key={photo.id}>
              <div className="photo-library-card-image">
                <button aria-label={`预览 ${photo.original_filename}`} className="photo-library-preview-trigger" onClick={() => setPreviewId(photo.id)} type="button"><PhotoImage photo={photo} /></button>
                <label className="photo-library-card-checkbox"><input aria-label={`选择 ${photo.original_filename}`} checked={selected.has(photo.id)} disabled={selectionBusy} onChange={() => togglePhoto(photo.id)} type="checkbox" /></label>
                <span className={`photo-library-result-badge is-${photo.result}`}>{RESULT_LABELS[photo.result]}</span>
                {photo.photo_type === "thermal" ? <span className="photo-library-thermal-badge">热成像</span> : null}
              </div>
              <div className="photo-library-card-body">
                <button className="photo-library-card-title" onClick={() => setPreviewId(photo.id)} title={photo.original_filename} type="button">{photo.original_filename}</button>
                <div className="photo-library-card-project"><span title={photo.project_name}>{photo.project_name}</span><span>{photo.facade_type ? FACADE_LABELS[photo.facade_type] : "未分类"}</span></div>
                <div className="photo-library-card-meta"><time dateTime={photo.created_at}>{formatDateTime(photo.created_at)}</time><span>{formatFileSize(photo.file_size)}</span></div>
              </div>
            </article>)}
          </div>}
      </div>
      <ListPagination ariaLabel="照片分页" currentPage={currentPage} itemUnit="张照片" onPageChange={(next) => { setPage(next); setPreviewId(null); }} pageSize={PAGE_SIZE} totalItems={photosQuery.isError ? 0 : total} />
    </section>
    {editingIds ? <PhotoFacadeDialog initialValue="" labels={FACADE_LABELS}
      pending={facadeMutation.isPending} error={facadeMutation.error?.message ?? null}
      onClose={() => setEditingIds(null)} onSubmit={(facade_type) => facadeMutation.mutate({ photo_ids: editingIds, facade_type })} /> : null}
    {previewPhoto ? <PhotoPreviewDialog
      exporting={exportMutation.isPending} onClose={() => setPreviewId(null)} onExport={() => exportMutation.mutate([previewPhoto.id])}
      onNext={previewIndex < items.length - 1 ? () => setPreviewId(items[previewIndex + 1].id) : undefined}
      onPrevious={previewIndex > 0 ? () => setPreviewId(items[previewIndex - 1].id) : undefined}
      photo={previewPhoto}
    /> : null}
  </div>;
}

function PhotoPreviewDialog({ photo, onClose, onNext, onPrevious, onExport, exporting }: {
  photo: LibraryPhoto; onClose: () => void; onNext?: () => void; onPrevious?: () => void; onExport: () => void; exporting: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    element?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return <dialog aria-labelledby="photo-library-preview-title" className="photo-library-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => {
      if (event.key === "ArrowRight") onNext?.();
      if (event.key === "ArrowLeft") onPrevious?.();
    }} ref={dialog}>
    <div className="photo-library-dialog-shell">
      <header><h2 id="photo-library-preview-title">照片详情</h2><button aria-label="关闭照片详情" className="back-cancel-button" onClick={onClose} type="button"><X aria-hidden="true" /></button></header>
      <div className="photo-library-dialog-content"><div className="photo-library-original"><PhotoImage original photo={photo} />
        <button aria-label="上一张照片" disabled={!onPrevious} onClick={onPrevious} type="button"><ChevronLeft aria-hidden="true" /></button>
        <button aria-label="下一张照片" disabled={!onNext} onClick={onNext} type="button"><ChevronRight aria-hidden="true" /></button>
      </div><aside className="photo-library-photo-details"><h3>{photo.original_filename}</h3><span className={`photo-library-result-badge is-${photo.result}`}>{RESULT_LABELS[photo.result]}</span>
        <dl><div><dt>检测来源</dt><dd>{photo.source_type === "trial" ? "快速体验" : "专业检测"}</dd></div><div><dt>检测项目</dt><dd>{photo.project_name}</dd></div><div><dt>项目编号</dt><dd>{photo.project_no}</dd></div>
          <div><dt>墙面类型</dt><dd>{photo.facade_type ? FACADE_LABELS[photo.facade_type] : "未分类"}</dd></div><div><dt>照片类型</dt><dd>{{ visible: "可见光", thermal: "热成像", dji: "DJI", other: "其他" }[photo.photo_type]}</dd></div>
          <div><dt>照片尺寸</dt><dd>{photo.image_width && photo.image_height ? `${photo.image_width} × ${photo.image_height} px` : "未知"}</dd></div><div><dt>文件大小</dt><dd>{formatFileSize(photo.file_size)}</dd></div>
          <div><dt>上传时间</dt><dd>{formatDateTime(photo.created_at)}</dd></div></dl>
        <h4>缺陷结果</h4><DefectTags photo={photo} />
        <Link className="back-cancel-button" onClick={onClose} to={photo.source_type === "trial" ? (photo.project_id ? `/trials/${photo.project_id}` : "/trials/new") : `/detections/${photo.project_id}`}>{photo.source_type === "trial" ? "查看快速体验" : "查看检测项目"}<ArrowUpRight aria-hidden="true" /></Link>
        <button className="primary-action-button" disabled={exporting} onClick={onExport} type="button"><ArrowDownToLine aria-hidden="true" />{exporting ? "正在导出…" : "导出此照片"}</button>
      </aside></div>
    </div>
  </dialog>;
}
