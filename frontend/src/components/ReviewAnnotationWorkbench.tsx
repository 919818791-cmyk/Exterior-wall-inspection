import { Button, Card, CardBody, Skeleton } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type Konva from "konva";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheckBig,
  ClipboardCheck,
  CopyPlus,
  Download,
  FileImage,
  FileUp,
  Grid2x2,
  Save,
  Trash2
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Image as KonvaImage, Layer, Rect, Stage, Text, Transformer } from "react-konva";
import {
  Link as RouterLink,
  useBeforeUnload,
  useBlocker,
  useNavigate
} from "react-router-dom";

import {
  reviewDetectionAnnotationsQueryOptions,
  saveReviewDetectionAnnotations
} from "@/api/review";
import { TilePreviewDialog, type TilePreviewSource } from "@/components/TilePreviewDialog";
import type {
  AnnotationBBox,
  AnnotationPhotoEdit,
  ManagedAnnotation
} from "@/types/reviewAnnotations";
import type { ReportDefectSnapshot, ReportDetail, ReportPhotoSnapshot } from "@/types/reports";
import { createAsyncLimiter } from "@/utils/asyncLimiter";
import { saveBlobAsFile } from "@/utils/download";
import { createClientId } from "@/utils/id";
import {
  parseReviewAnnotationJson,
  type AnnotationImportMatch
} from "@/utils/reviewAnnotationImport";
import { formatDefectNumber } from "@/utils/trialDefectDisplay";

const DEFECT_OPTIONS = [
  { value: "crack", label: "裂缝", color: "#ef4444" },
  { value: "spalling", label: "剥落", color: "#f97316" },
  { value: "moisture", label: "潮湿", color: "#0ea5e9" },
  { value: "corrosion", label: "锈蚀", color: "#a16207" },
  { value: "hollow", label: "空鼓", color: "#7c3aed" }
] as const;

const DEFECT_COLORS = Object.fromEntries(DEFECT_OPTIONS.map((item) => [item.value, item.color]));
const MIN_CANVAS_ZOOM = 1;
const MAX_CANVAS_ZOOM = 4;
const CANVAS_ZOOM_STEP = 1.1;
const MIN_DRAWN_BOX_SIZE = 8;

interface AnnotationPhotoRowData {
  key: string;
  filename: string;
  imageUrl: string;
  imageWidth: number | null;
  imageHeight: number | null;
  tileWidth?: number | string | null;
  tileHeight?: number | string | null;
  tileOverlapRatio?: number | string | null;
  detections?: TilePreviewSource["detections"];
  defects: ReportDefectSnapshot[];
}

interface AnnotationEditorSaveStatus {
  dirty: boolean;
  isSaving: boolean;
}

interface AnnotationImportNotice {
  message: string;
  tone: "error" | "success";
}

type AnnotationEditorSaveHandler = () => void;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function finiteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundedBBox(bbox: AnnotationBBox): AnnotationBBox {
  return {
    x: Math.round(Math.max(0, bbox.x) * 100) / 100,
    y: Math.round(Math.max(0, bbox.y) * 100) / 100,
    width: Math.round(Math.max(4, bbox.width) * 100) / 100,
    height: Math.round(Math.max(4, bbox.height) * 100) / 100
  };
}

function cleanAnnotations(annotations: ManagedAnnotation[]) {
  return annotations.map((annotation) => ({ ...annotation, bbox: roundedBBox(annotation.bbox) }));
}

function annotationColor(defectType: string) {
  return DEFECT_COLORS[defectType] ?? "#64748b";
}

function clampCanvasPosition(position: { x: number; y: number }, zoom: number, width: number, height: number) {
  return {
    x: Math.min(0, Math.max(width * (1 - zoom), position.x)),
    y: Math.min(0, Math.max(height * (1 - zoom), position.y))
  };
}

function useCanvasImage(src: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setImage(null);
    setFailed(false);
    if (!src) return;
    let cancelled = false;
    const next = new window.Image();
    next.onload = () => { if (!cancelled) setImage(next); };
    next.onerror = () => { if (!cancelled) setFailed(true); };
    next.src = src;
    return () => { cancelled = true; };
  }, [src]);

  return { image, failed };
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    setWidth(ref.current.clientWidth);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function ReviewAnnotationWorkbench({
  backLabel,
  backTo,
  pageTitle,
  projectName,
  reviewTaskId
}: {
  backLabel: string;
  backTo: string;
  pageTitle: string;
  projectName?: string;
  reviewTaskId: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const detailQuery = useQuery(reviewDetectionAnnotationsQueryOptions(reviewTaskId));
  const rows = useMemo(
    () => detailQuery.data ? buildAnnotationPhotoRows(detailQuery.data.result) : [],
    [detailQuery.data]
  );
  const editsByPhoto = useMemo(
    () => new Map((detailQuery.data?.edits ?? []).map((edit) => [edit.photo_key, edit])),
    [detailQuery.data?.edits]
  );
  const [selectedPhotoKey, setSelectedPhotoKey] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importNotice, setImportNotice] = useState<AnnotationImportNotice | null>(null);
  const editorSaveHandlersRef = useRef(new Map<string, AnnotationEditorSaveHandler>());
  const defectNumberRegistryRef = useRef(new Set<string>());
  const [editorSaveStatuses, setEditorSaveStatuses] = useState<Record<string, AnnotationEditorSaveStatus>>({});

  useEffect(() => {
    const used = new Set<string>();
    detailQuery.data?.result.defects.forEach((defect) => {
      if (defect.defect_no) used.add(defect.defect_no);
    });
    detailQuery.data?.edits.forEach((edit) => {
      edit.annotations.forEach((annotation) => {
        if (annotation.defect_no) used.add(annotation.defect_no);
      });
    });
    defectNumberRegistryRef.current = used;
  }, [detailQuery.data]);

  const allocateDefectNumber = useCallback((defectType: string) => {
    let sequence = 1;
    let candidate = formatDefectNumber(defectType, sequence);
    while (defectNumberRegistryRef.current.has(candidate)) {
      sequence += 1;
      candidate = formatDefectNumber(defectType, sequence);
    }
    defectNumberRegistryRef.current.add(candidate);
    return candidate;
  }, []);

  useEffect(() => {
    setSelectedPhotoKey((current) => {
      if (current && rows.some((row) => row.key === current)) return current;
      return rows[0]?.key ?? null;
    });
  }, [rows]);

  const activePhotoKey = selectedPhotoKey && rows.some((row) => row.key === selectedPhotoKey)
    ? selectedPhotoKey
    : rows[0]?.key ?? null;
  const selectedPhotoIndex = Math.max(0, rows.findIndex((row) => row.key === activePhotoKey));

  function selectPhoto(index: number) {
    const nextRow = rows[index];
    if (nextRow) setSelectedPhotoKey(nextRow.key);
  }

  const registerEditorSaveHandler = useCallback((
    photoKey: string,
    handler: AnnotationEditorSaveHandler | null
  ) => {
    if (handler) {
      editorSaveHandlersRef.current.set(photoKey, handler);
    } else {
      editorSaveHandlersRef.current.delete(photoKey);
    }
  }, []);

  const updateEditorSaveStatus = useCallback((
    photoKey: string,
    status: AnnotationEditorSaveStatus
  ) => {
    setEditorSaveStatuses((current) => {
      const previous = current[photoKey];
      if (previous?.dirty === status.dirty && previous.isSaving === status.isSaving) {
        return current;
      }
      return { ...current, [photoKey]: status };
    });
  }, []);
  const hasUnsavedChanges = rows.some((row) => editorSaveStatuses[row.key]?.dirty);
  const isAnyEditorSaving = rows.some((row) => editorSaveStatuses[row.key]?.isSaving);
  const importMutation = useMutation({
    mutationFn: async (matches: AnnotationImportMatch[]) => {
      const runLimited = createAsyncLimiter(4);
      const results = await Promise.allSettled(matches.map((match) => runLimited(() => (
        saveReviewDetectionAnnotations(reviewTaskId, {
          photo_key: match.photoKey,
          annotations: match.annotations
        })
      ))));
      const failedCount = results.filter((result) => result.status === "rejected").length;
      if (failedCount) {
        throw new Error(`已保存 ${matches.length - failedCount} 张照片，另有 ${failedCount} 张保存失败，请检查后重试。`);
      }
      return {
        annotationCount: matches.reduce((total, match) => total + match.annotations.length, 0),
        photoCount: matches.length
      };
    },
    onSuccess: ({ annotationCount, photoCount }) => {
      setImportNotice({
        tone: "success",
        message: `批量导入完成：已更新 ${photoCount} 张照片，共 ${annotationCount} 个标注框。`
      });
    },
    onError: (error) => {
      setImportNotice({ tone: "error", message: errorMessage(error) });
    },
    onSettled: async () => {
      setEditorSaveStatuses({});
      await queryClient.invalidateQueries({ queryKey: ["review", "detections"] });
    }
  });
  const hasBlockingWork = hasUnsavedChanges || isAnyEditorSaving || importMutation.isPending;
  const navigationBlocker = useBlocker(({ currentLocation, nextLocation }) => (
    hasBlockingWork
    && `${currentLocation.pathname}${currentLocation.search}` !== `${nextLocation.pathname}${nextLocation.search}`
  ));
  const warnBeforeUnload = useCallback((event: BeforeUnloadEvent) => {
    if (!hasBlockingWork) return;
    event.preventDefault();
    event.returnValue = "";
  }, [hasBlockingWork]);

  useBeforeUnload(warnBeforeUnload);

  useEffect(() => {
    if (navigationBlocker.state !== "blocked") return;
    const message = importMutation.isPending || isAnyEditorSaving
      ? "标注正在保存，立即离开可能导致部分修改未完成。确认离开？"
      : "当前有未保存的标注，离开页面后修改将丢失。确认离开？";
    if (window.confirm(message)) {
      navigationBlocker.proceed();
    } else {
      navigationBlocker.reset();
    }
  }, [importMutation.isPending, isAnyEditorSaving, navigationBlocker.state]);

  if (detailQuery.isLoading) {
    return <div className="grid gap-5"><Skeleton className="h-24 rounded-lg" /><Skeleton className="h-[560px] rounded-lg" /></div>;
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="grid min-h-[calc(100svh-8rem)] place-items-center">
        <Card className="w-full max-w-2xl rounded-lg border border-red-200 shadow-none">
          <CardBody className="gap-4 p-6">
            <h1 className="text-xl font-black text-ink">{pageTitle}详情加载失败</h1>
            <p className="text-sm font-bold text-red-700">{errorMessage(detailQuery.error)}</p>
            <RouterLink className="back-cancel-button" to={backTo}>
              <ChevronLeft aria-hidden="true" />
              <span>{backLabel}</span>
            </RouterLink>
          </CardBody>
        </Card>
      </div>
    );
  }

  const report = detailQuery.data.result;
  const readOnly = report.status === "revoked";
  const activeSaveStatus = activePhotoKey ? editorSaveStatuses[activePhotoKey] : undefined;
  const saveActivePhoto = () => {
    if (!activePhotoKey || readOnly || !activeSaveStatus?.dirty || activeSaveStatus.isSaving) return;
    editorSaveHandlersRef.current.get(activePhotoKey)?.();
  };
  const importPhotos = rows.map((row) => ({
    key: row.key,
    filename: row.filename,
    imageWidth: row.imageWidth,
    imageHeight: row.imageHeight
  }));

  async function importAnnotationFiles(files: FileList | null) {
    if (!files?.length || readOnly || importMutation.isPending) return;
    if (hasUnsavedChanges || isAnyEditorSaving) {
      setImportNotice({ tone: "error", message: "请先保存当前未保存的标注，再执行批量导入。" });
      return;
    }

    setImportNotice(null);
    const matches: AnnotationImportMatch[] = [];
    const unmatched = new Set<string>();
    const errors: string[] = [];
    const selectedFiles = Array.from(files);
    if (selectedFiles.length > 100) {
      setImportNotice({ tone: "error", message: "单次最多导入 100 个 JSON 文件。" });
      return;
    }

    await Promise.all(selectedFiles.map(async (file) => {
      try {
        if (file.size > 20 * 1024 * 1024) {
          throw new Error(`${file.name} 超过 20 MB，无法导入。`);
        }
        const parsed = parseReviewAnnotationJson(file.name, await file.text(), importPhotos);
        matches.push(...parsed.matches);
        parsed.unmatchedPhotoNames.forEach((name) => unmatched.add(name));
      } catch (error) {
        errors.push(errorMessage(error));
      }
    }));

    if (errors.length) {
      const extraCount = Math.max(0, errors.length - 3);
      setImportNotice({
        tone: "error",
        message: `${errors.slice(0, 3).join("；")}${extraCount ? `；另有 ${extraCount} 个文件不符合格式` : ""}`
      });
      return;
    }

    const duplicateFilenames = matches
      .filter((match, index) => matches.findIndex((candidate) => candidate.photoKey === match.photoKey) !== index)
      .map((match) => match.filename);
    if (duplicateFilenames.length) {
      setImportNotice({
        tone: "error",
        message: `同一照片在导入内容中出现多次：${Array.from(new Set(duplicateFilenames)).slice(0, 3).join("、")}。请合并后重试。`
      });
      return;
    }

    if (!matches.length) {
      setImportNotice({
        tone: "error",
        message: unmatched.size
          ? `未匹配到当前任务照片，请检查 JSON 中的图片名（已跳过 ${unmatched.size} 张）。`
          : "没有可导入的标注框。"
      });
      return;
    }

    const annotationCount = matches.reduce((total, match) => total + match.annotations.length, 0);
    const skippedMessage = unmatched.size ? `，另有 ${unmatched.size} 张未匹配照片将跳过` : "";
    const confirmed = window.confirm(
      `将用导入内容覆盖 ${matches.length} 张照片的现有标注，共 ${annotationCount} 个标注框${skippedMessage}。导入后会立即保存，是否继续？`
    );
    if (confirmed) importMutation.mutate(matches);
  }

  function handleImportInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.currentTarget.files;
    void importAnnotationFiles(files);
    event.currentTarget.value = "";
  }

  function exportAnnotations() {
    if (hasUnsavedChanges || isAnyEditorSaving || importMutation.isPending) {
      setImportNotice({ tone: "error", message: "请先保存所有照片的标注，等待保存完成后再导出 JSON。" });
      return;
    }

    const images = rows.map((row) => {
      const imageWidth = Math.max(1, row.imageWidth ?? 1200);
      const imageHeight = Math.max(1, row.imageHeight ?? 800);
      const annotations = cleanAnnotations(
        editsByPhoto.get(row.key)?.annotations
        ?? annotationsFromDefects(row.defects, imageWidth, imageHeight)
      );
      return {
        image_name: row.filename,
        image_width: imageWidth,
        image_height: imageHeight,
        annotations: annotations.map((annotation) => ({
          id: annotation.id,
          source_annotation_id: annotation.source_annotation_id,
          defect_no: annotation.defect_no,
          defect_type: annotation.defect_type,
          bbox: annotation.bbox,
          confidence: annotation.confidence
        }))
      };
    });
    const exportData = {
      schema: "building-exterior-review-annotations",
      version: 1,
      project_name: projectName ?? report.title,
      review_task_id: reviewTaskId,
      exported_at: new Date().toISOString(),
      images
    };
    const baseName = (projectName || report.title || report.report_no || "审核标注")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .trim()
      .slice(0, 120) || "审核标注";
    saveBlobAsFile(
      new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json;charset=utf-8" }),
      `${baseName}-标注.json`
    );
    const annotationCount = images.reduce((total, image) => total + image.annotations.length, 0);
    setImportNotice({
      tone: "success",
      message: `JSON 导出完成：${images.length} 张照片，共 ${annotationCount} 个标注框。`
    });
  }

  const previewAnnotations = () => {
    if (hasUnsavedChanges || isAnyEditorSaving) {
      window.alert("请先保存所有照片的标注，等待保存完成后再预览结果。");
      return;
    }
    const query = new URLSearchParams({ reviewTaskId });
    navigate(`/detections/results/${report.id}?${query.toString()}`);
  };
  return (
    <div className="review-annotation-detail grid gap-5">
      {rows.length ? (
        <section className="annotation-detail-workbench" aria-label="照片标注编辑工作台">
          <header className="annotation-detail-header">
            <div className="management-page-title">
              <ClipboardCheck aria-hidden="true" className="management-page-title-icon" />
              <div>
                <h1>{pageTitle}</h1>
                {projectName ? (
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    {projectName}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="annotation-detail-header-actions">
              <input
                ref={importInputRef}
                className="sr-only"
                accept=".json,application/json"
                aria-label="批量导入标注框 JSON"
                disabled={readOnly || hasUnsavedChanges || isAnyEditorSaving || importMutation.isPending}
                multiple
                type="file"
                onChange={handleImportInputChange}
              />
              <button
                className="button primary-action-button annotation-complete-review"
                disabled={readOnly || hasUnsavedChanges || isAnyEditorSaving || importMutation.isPending}
                type="button"
                onClick={previewAnnotations}
              >
                <CircleCheckBig aria-hidden="true" />
                {readOnly
                  ? "当前审核不可编辑"
                  : hasUnsavedChanges || isAnyEditorSaving
                    ? "请先保存标注"
                    : "预览报告"}
              </button>
              <button
                className="button primary-action-button annotation-save-annotations"
                disabled={readOnly || !activeSaveStatus?.dirty || activeSaveStatus.isSaving || importMutation.isPending}
                type="button"
                onClick={saveActivePhoto}
              >
                <Save aria-hidden="true" />
                {activeSaveStatus?.isSaving ? "保存中…" : "保存标注"}
              </button>
              <button
                className="button primary-action-button annotation-import-annotations"
                disabled={readOnly || hasUnsavedChanges || isAnyEditorSaving || importMutation.isPending}
                title={hasUnsavedChanges ? "请先保存当前未保存的标注" : "按照片文件名匹配并覆盖现有标注"}
                type="button"
                onClick={() => importInputRef.current?.click()}
              >
                <FileUp aria-hidden="true" />
                {importMutation.isPending ? "导入保存中…" : "批量导入 JSON"}
              </button>
              <button
                className="button primary-action-button annotation-export-annotations"
                disabled={hasUnsavedChanges || isAnyEditorSaving || importMutation.isPending}
                title={hasUnsavedChanges ? "请先保存当前未保存的标注" : "导出全部照片的已保存标注"}
                type="button"
                onClick={exportAnnotations}
              >
                <Download aria-hidden="true" />
                导出 JSON
              </button>
              <RouterLink
                aria-label={backLabel}
                className="back-cancel-button"
                title={backLabel}
                to={backTo}
              >
                <ChevronLeft aria-hidden="true" />
              </RouterLink>
            </div>
          </header>

          {importNotice ? (
            <p
              className={`annotation-import-notice is-${importNotice.tone}`}
              role={importNotice.tone === "error" ? "alert" : "status"}
            >
              {importNotice.message}
            </p>
          ) : null}

          <aside className="annotation-photo-rail" aria-label="照片缩略图列表">
            <div className="annotation-photo-rail-heading">
              <strong>照片列表</strong>
              <span>{selectedPhotoIndex + 1} / {rows.length}</span>
            </div>
            <div className="annotation-photo-thumbnails">
              {rows.map((row, index) => {
                const active = row.key === activePhotoKey;
                return (
                  <button
                    key={row.key}
                    className={`annotation-photo-thumbnail ${active ? "is-active" : ""}`}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    aria-label={`编辑第 ${index + 1} 张照片：${row.filename}`}
                    onClick={() => selectPhoto(index)}
                  >
                    <span className="annotation-photo-thumbnail-image">
                      {row.imageUrl ? <img alt="" src={row.imageUrl} /> : <FileImage aria-hidden="true" />}
                      <span className="annotation-photo-thumbnail-index">{String(index + 1).padStart(2, "0")}</span>
                    </span>
                    <span className="annotation-photo-thumbnail-name" title={row.filename}>{row.filename}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="annotation-editor-space">
            <div className="annotation-editor-stack">
              {rows.map((row, index) => (
                <div
                  key={row.key}
                  className={`annotation-editor-pane ${row.key === activePhotoKey ? "is-active" : ""}`}
                  aria-hidden={row.key === activePhotoKey ? undefined : "true"}
                >
                  <AnnotationPhotoEditor
                    edit={editsByPhoto.get(row.key)}
                    photoCount={rows.length}
                    photoIndex={index}
                    readOnly={readOnly}
                    reviewTaskId={reviewTaskId}
                    row={row}
                    onAllocateDefectNumber={allocateDefectNumber}
                    onRegisterSaveHandler={registerEditorSaveHandler}
                    onSaveStatusChange={updateEditorSaveStatus}
                    onSelectPhoto={selectPhoto}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <Card className="rounded-lg border border-slate-200 shadow-none">
          <CardBody className="grid min-h-64 place-items-center text-center">
            <div><FileImage className="mx-auto h-10 w-10 text-slate-400" aria-hidden="true" /><strong className="mt-3 block text-ink">当前结果没有照片</strong></div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function AnnotationPhotoEditor({
  edit,
  photoCount,
  photoIndex,
  readOnly,
  reviewTaskId,
  row,
  onAllocateDefectNumber,
  onRegisterSaveHandler,
  onSaveStatusChange,
  onSelectPhoto
}: {
  edit?: AnnotationPhotoEdit;
  photoCount: number;
  photoIndex: number;
  readOnly: boolean;
  reviewTaskId: string;
  row: AnnotationPhotoRowData;
  onAllocateDefectNumber: (defectType: string) => string;
  onRegisterSaveHandler: (photoKey: string, handler: AnnotationEditorSaveHandler | null) => void;
  onSaveStatusChange: (photoKey: string, status: AnnotationEditorSaveStatus) => void;
  onSelectPhoto: (index: number) => void;
}) {
  const queryClient = useQueryClient();
  const { image, failed } = useCanvasImage(row.imageUrl);
  const imageWidth = Math.max(1, row.imageWidth ?? image?.naturalWidth ?? 1200);
  const imageHeight = Math.max(1, row.imageHeight ?? image?.naturalHeight ?? 800);
  const originalAnnotations = useMemo(
    () => annotationsFromDefects(row.defects, imageWidth, imageHeight),
    [imageHeight, imageWidth, row.defects]
  );
  const savedAnnotations = useMemo(
    () => mergeDefectNumbers(edit?.annotations ?? originalAnnotations, row.defects),
    [edit?.annotations, originalAnnotations, row.defects]
  );
  const [annotations, setAnnotations] = useState<ManagedAnnotation[]>(savedAnnotations);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tilePreviewOpen, setTilePreviewOpen] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (touched) return;
    setAnnotations(savedAnnotations);
    setSelectedId((current) => savedAnnotations.some((item) => item.id === current) ? current : null);
  }, [savedAnnotations, touched]);

  useEffect(() => {
    if (!isDrawing) return;
    const cancelDrawing = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsDrawing(false);
    };
    window.addEventListener("keydown", cancelDrawing);
    return () => window.removeEventListener("keydown", cancelDrawing);
  }, [isDrawing]);

  const selected = annotations.find((annotation) => annotation.id === selectedId) ?? null;
  const selectedIndex = selected
    ? annotations.findIndex((annotation) => annotation.id === selected.id)
    : -1;
  const tilePreviewSource = useMemo<TilePreviewSource>(() => ({
    filename: row.filename,
    imageUrl: row.imageUrl,
    imageWidth,
    imageHeight,
    tileWidth: row.tileWidth,
    tileHeight: row.tileHeight,
    tileOverlapRatio: row.tileOverlapRatio,
    detections: row.detections
  }), [imageHeight, imageWidth, row.detections, row.filename, row.imageUrl, row.tileHeight, row.tileOverlapRatio, row.tileWidth]);
  const dirty = JSON.stringify(cleanAnnotations(annotations)) !== JSON.stringify(cleanAnnotations(savedAnnotations));
  const defectOptions = DEFECT_OPTIONS.filter((option) => ["crack", "spalling", "hollow"].includes(option.value));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["review", "detections"] });
  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        photo_key: row.key,
        annotations: cleanAnnotations(annotations)
      };
      return saveReviewDetectionAnnotations(reviewTaskId, payload);
    },
    onSuccess: async () => {
      setTouched(false);
      await invalidate();
    }
  });

  const saveCurrentAnnotations = useCallback(() => {
    if (readOnly || !dirty || saveMutation.isPending) return;
    saveMutation.mutate();
  }, [dirty, readOnly, saveMutation.isPending, saveMutation.mutate]);

  useEffect(() => {
    onRegisterSaveHandler(row.key, saveCurrentAnnotations);
    return () => onRegisterSaveHandler(row.key, null);
  }, [onRegisterSaveHandler, row.key, saveCurrentAnnotations]);

  useEffect(() => {
    onSaveStatusChange(row.key, {
      dirty,
      isSaving: saveMutation.isPending
    });
  }, [dirty, onSaveStatusChange, row.key, saveMutation.isPending]);

  function updateAnnotation(annotationId: string, patch: Partial<ManagedAnnotation>) {
    if (readOnly) return;
    setAnnotations((current) => current.map((item, index) => {
      if (item.id !== annotationId) return item;
      const next = { ...item, ...patch };
      if (patch.defect_type && patch.defect_type !== item.defect_type) {
        next.defect_no = onAllocateDefectNumber(patch.defect_type);
      }
      return next;
    }));
    setSelectedId(annotationId);
    setTouched(true);
  }

  function createAnnotation(bbox: AnnotationBBox) {
    if (readOnly) return;
    const annotation: ManagedAnnotation = {
      id: createClientId("annotation"),
      source_annotation_id: null,
      defect_no: onAllocateDefectNumber("crack"),
      defect_type: "crack",
      confidence: null,
      bbox: roundedBBox(bbox)
    };
    setAnnotations((current) => [...current, annotation]);
    setSelectedId(annotation.id);
    setIsDrawing(false);
    setTouched(true);
  }

  function toggleDrawing() {
    if (readOnly) return;
    setIsDrawing((current) => {
      const next = !current;
      if (next) setSelectedId(null);
      return next;
    });
  }

  function deleteSelected() {
    if (!selected || readOnly) return;
    setAnnotations((current) => current.filter((item) => item.id !== selected.id));
    setSelectedId(null);
    setTouched(true);
  }

  const activeError = saveMutation.error;
  return (
    <div className="annotation-photo-editor-module">
      {activeError ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{errorMessage(activeError)}</p> : null}

      <AnnotationColumn title={row.filename}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <AnnotationIconButton
            disabled={readOnly}
            isCancel={isDrawing}
            label={isDrawing ? "取消画框" : "新增标注"}
            pressed={isDrawing}
            tone="add"
            onPress={toggleDrawing}
          >
            <CopyPlus aria-hidden="true" />
          </AnnotationIconButton>
          <AnnotationIconButton
            disabled={!row.imageUrl}
            label="查看TILE"
            tone="tile"
            onPress={() => setTilePreviewOpen(true)}
          >
            <Grid2x2 aria-hidden="true" />
          </AnnotationIconButton>
          <AnnotationIconButton
            disabled={!selected || readOnly}
            label="删除标注"
            tone="delete"
            onPress={deleteSelected}
          >
            <Trash2 aria-hidden="true" />
          </AnnotationIconButton>
          <p className="min-w-0 text-sm font-bold text-slate-500" aria-live="polite">
            {isDrawing ? (
              <strong className="text-green-700">请在照片上按住鼠标并拖动绘制标注框，按 Esc 可取消</strong>
            ) : (
              <>
                当前选中的标注框：
                <strong className="text-slate-800">
                  {selected && selectedIndex >= 0
                    ? selected.defect_no || formatDefectNumber(selected.defect_type, selectedIndex + 1)
                    : "未选择"}
                </strong>
              </>
            )}
          </p>
          {selected ? (
            <label className="ml-auto flex items-center gap-2 text-sm font-bold text-slate-500">
              类型
              <select
                className="h-10 w-[98px] rounded-lg border border-slate-300 bg-white px-3 text-base font-bold text-slate-700 outline-none focus:border-action"
                disabled={readOnly}
                value={selected.defect_type}
                onChange={(event) => updateAnnotation(selected.id, { defect_type: event.target.value })}
              >
                {!defectOptions.some((option) => option.value === selected.defect_type) ? <option value={selected.defect_type}>{selected.defect_type}</option> : null}
                {defectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        <AnnotationCanvas
          annotations={annotations}
          drawingEnabled={isDrawing}
          failed={failed}
          image={image}
          imageHeight={imageHeight}
          imageWidth={imageWidth}
          imageUrl={row.imageUrl}
          readOnly={readOnly}
          selectedId={selectedId}
          onCreate={createAnnotation}
          onSelect={setSelectedId}
          onUpdateBBox={(annotationId, bbox) => updateAnnotation(annotationId, { bbox })}
        />
        <div className="annotation-editor-footer">
          <div className="annotation-editor-photo-selector">
            <button
              className="annotation-editor-arrow"
              disabled={photoIndex === 0}
              type="button"
              aria-label="上一张照片"
              onClick={() => onSelectPhoto(photoIndex - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <h3 className="annotation-editor-filename" title={row.filename}>{row.filename}</h3>
            <button
              className="annotation-editor-arrow"
              disabled={photoIndex === photoCount - 1}
              type="button"
              aria-label="下一张照片"
              onClick={() => onSelectPhoto(photoIndex + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          </div>
        </AnnotationColumn>
        {tilePreviewOpen ? (
          <TilePreviewDialog source={tilePreviewSource} onClose={() => setTilePreviewOpen(false)} />
        ) : null}
      </div>
  );
}

function AnnotationIconButton({
  children,
  disabled,
  isCancel,
  label,
  onPress,
  pressed,
  tone
}: {
  children: React.ReactNode;
  disabled: boolean;
  isCancel?: boolean;
  label: string;
  onPress: () => void;
  pressed?: boolean;
  tone: "add" | "delete" | "tile";
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={pressed}
      className={`annotation-action-button annotation-action-${tone}${isCancel ? " back-cancel-button" : ""}`}
      isDisabled={disabled}
      isIconOnly
      size="sm"
      title={label}
      variant="flat"
      onPress={onPress}
    >
      {children}
    </Button>
  );
}

function AnnotationColumn({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section aria-label={title} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3">
      {children}
    </section>
  );
}

function AnnotationCanvas({
  annotations,
  drawingEnabled,
  failed,
  image,
  imageHeight,
  imageUrl,
  imageWidth,
  onCreate,
  onSelect,
  onUpdateBBox,
  readOnly,
  selectedId
}: {
  annotations: ManagedAnnotation[];
  drawingEnabled: boolean;
  failed: boolean;
  image: HTMLImageElement | null;
  imageHeight: number;
  imageUrl: string;
  imageWidth: number;
  onCreate: (bbox: AnnotationBBox) => void;
  onSelect: (annotationId: string) => void;
  onUpdateBBox: (annotationId: string, bbox: AnnotationBBox) => void;
  readOnly: boolean;
  selectedId: string | null;
}) {
  const [containerRef, containerWidth] = useElementWidth<HTMLDivElement>();
  const stageRef = useRef<Konva.Stage | null>(null);
  const selectedRectRef = useRef<Konva.Rect | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const [zoom, setZoom] = useState(MIN_CANVAS_ZOOM);
  const [canvasPosition, setCanvasPosition] = useState({ x: 0, y: 0 });
  const [drawingStart, setDrawingStart] = useState<{ x: number; y: number } | null>(null);
  const [draftRect, setDraftRect] = useState<AnnotationBBox | null>(null);
  const stageWidth = Math.max(280, containerWidth || 480);
  const availableWidth = Math.max(1, stageWidth - 24);
  const stageHeight = stageWidth * 3 / 4;
  const availableHeight = Math.max(1, stageHeight - 24);
  const scale = Math.min(availableWidth / imageWidth, availableHeight / imageHeight);
  const renderedWidth = Math.max(1, imageWidth * scale);
  const renderedHeight = Math.max(1, imageHeight * scale);
  const offsetX = Math.max(12, (stageWidth - renderedWidth) / 2);
  const offsetY = Math.max(12, (stageHeight - renderedHeight) / 2);

  useEffect(() => {
    setZoom(MIN_CANVAS_ZOOM);
    setCanvasPosition({ x: 0, y: 0 });
  }, [imageUrl, stageHeight, stageWidth]);

  useEffect(() => {
    if (drawingEnabled) return;
    setDrawingStart(null);
    setDraftRect(null);
  }, [drawingEnabled]);

  useEffect(() => {
    if (!transformerRef.current) return;
    if (!readOnly && selectedId && selectedRectRef.current) {
      transformerRef.current.nodes([selectedRectRef.current]);
    } else {
      transformerRef.current.nodes([]);
    }
    transformerRef.current.getLayer()?.batchDraw();
  }, [annotations, readOnly, selectedId]);

  function stageRect(bbox: AnnotationBBox) {
    return { x: offsetX + bbox.x * scale, y: offsetY + bbox.y * scale, width: bbox.width * scale, height: bbox.height * scale };
  }

  function imageRect(rect: AnnotationBBox): AnnotationBBox {
    const width = Math.min(imageWidth, Math.max(4, rect.width / scale));
    const height = Math.min(imageHeight, Math.max(4, rect.height / scale));
    return roundedBBox({
      x: Math.min(imageWidth - width, Math.max(0, (rect.x - offsetX) / scale)),
      y: Math.min(imageHeight - height, Math.max(0, (rect.y - offsetY) / scale)),
      width,
      height
    });
  }

  function pointerOnImage(requireInside: boolean) {
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return null;
    const point = {
      x: (pointer.x - canvasPosition.x) / zoom,
      y: (pointer.y - canvasPosition.y) / zoom
    };
    const right = offsetX + renderedWidth;
    const bottom = offsetY + renderedHeight;
    if (requireInside && (point.x < offsetX || point.x > right || point.y < offsetY || point.y > bottom)) {
      return null;
    }
    return {
      x: Math.min(right, Math.max(offsetX, point.x)),
      y: Math.min(bottom, Math.max(offsetY, point.y))
    };
  }

  function normalizedDraft(start: { x: number; y: number }, end: { x: number; y: number }): AnnotationBBox {
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y)
    };
  }

  function handleDrawStart() {
    if (!drawingEnabled || readOnly) return;
    const point = pointerOnImage(true);
    if (!point) return;
    setDrawingStart(point);
    setDraftRect({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  function handleDrawMove() {
    if (!drawingEnabled || !drawingStart) return;
    const point = pointerOnImage(false);
    if (!point) return;
    setDraftRect(normalizedDraft(drawingStart, point));
  }

  function handleDrawEnd() {
    if (!drawingEnabled || !drawingStart) return;
    const point = pointerOnImage(false);
    const completed = point ? normalizedDraft(drawingStart, point) : draftRect;
    setDrawingStart(null);
    setDraftRect(null);
    if (!completed || completed.width < MIN_DRAWN_BOX_SIZE / zoom || completed.height < MIN_DRAWN_BOX_SIZE / zoom) return;
    onCreate(imageRect(completed));
  }

  function handleWheel(event: Konva.KonvaEventObject<WheelEvent>) {
    event.evt.preventDefault();
    if (drawingEnabled) return;
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return;

    const nextZoom = Math.min(
      MAX_CANVAS_ZOOM,
      Math.max(MIN_CANVAS_ZOOM, event.evt.deltaY < 0 ? zoom * CANVAS_ZOOM_STEP : zoom / CANVAS_ZOOM_STEP)
    );
    if (nextZoom === zoom) return;

    const pointOnCanvas = {
      x: (pointer.x - canvasPosition.x) / zoom,
      y: (pointer.y - canvasPosition.y) / zoom
    };
    const nextPosition = clampCanvasPosition({
      x: pointer.x - pointOnCanvas.x * nextZoom,
      y: pointer.y - pointOnCanvas.y * nextZoom
    }, nextZoom, stageWidth, stageHeight);

    setZoom(nextZoom);
    setCanvasPosition(nextPosition);
  }

  return (
    <div ref={containerRef} className={`annotation-canvas-viewport overflow-hidden rounded-lg border border-slate-200 bg-slate-200 ${drawingEnabled ? "is-drawing" : ""}`}>
      {!imageUrl ? (
        <div className="grid min-h-64 place-items-center text-sm font-bold text-slate-500">照片没有可预览地址</div>
      ) : failed ? (
        <div className="grid min-h-64 place-items-center text-sm font-bold text-red-600">图片加载失败</div>
      ) : (
        <>
          <Stage
            ref={stageRef}
            draggable={!drawingEnabled && zoom > MIN_CANVAS_ZOOM}
            height={stageHeight}
            scaleX={zoom}
            scaleY={zoom}
            width={stageWidth}
            x={canvasPosition.x}
            y={canvasPosition.y}
            dragBoundFunc={(position) => clampCanvasPosition(position, zoom, stageWidth, stageHeight)}
            onDragEnd={(event) => {
              if (event.target === stageRef.current) {
                setCanvasPosition(clampCanvasPosition(event.target.position(), zoom, stageWidth, stageHeight));
              }
            }}
            onMouseDown={handleDrawStart}
            onMouseMove={handleDrawMove}
            onMouseUp={handleDrawEnd}
            onTouchEnd={handleDrawEnd}
            onTouchMove={handleDrawMove}
            onTouchStart={handleDrawStart}
            onWheel={handleWheel}
          >
          <Layer>
            <Rect fill="#e2e8f0" height={stageHeight} width={stageWidth} x={0} y={0} />
            {image ? <KonvaImage image={image} x={offsetX} y={offsetY} width={renderedWidth} height={renderedHeight} /> : <Rect fill="#e2e8f0" x={offsetX} y={offsetY} width={renderedWidth} height={renderedHeight} />}
            {annotations.map((annotation) => {
              const rect = stageRect(annotation.bbox);
              const selected = annotation.id === selectedId;
              const color = annotationColor(annotation.defect_type);
              return (
                <Rect
                  key={annotation.id}
                  name="annotation-shape"
                  ref={(node) => { if (selected) selectedRectRef.current = node; }}
                  draggable={!readOnly && !drawingEnabled && selected}
                  fill={selected ? `${color}24` : `${color}12`}
                  height={rect.height}
                  stroke={color}
                  strokeScaleEnabled={false}
                  strokeWidth={selected ? 3 : 2}
                  width={rect.width}
                  x={rect.x}
                  y={rect.y}
                  onClick={() => { if (!readOnly && !drawingEnabled) onSelect(annotation.id); }}
                  onTap={() => { if (!readOnly && !drawingEnabled) onSelect(annotation.id); }}
                  onDragStart={() => { if (!drawingEnabled) onSelect(annotation.id); }}
                  onDragEnd={(event) => onUpdateBBox(annotation.id, imageRect({ x: event.target.x(), y: event.target.y(), width: rect.width, height: rect.height }))}
                  onTransformEnd={(event) => {
                    const node = event.target;
                    const scaleX = node.scaleX();
                    const scaleY = node.scaleY();
                    node.scaleX(1);
                    node.scaleY(1);
                    onUpdateBBox(annotation.id, imageRect({ x: node.x(), y: node.y(), width: node.width() * scaleX, height: node.height() * scaleY }));
                  }}
                />
              );
            })}
            {annotations.map((annotation, index) => {
              const rect = stageRect(annotation.bbox);
              const label = annotation.defect_no || formatDefectNumber(annotation.defect_type, index + 1);
              const labelWidth = Math.max(62, label.length * 12);
              const y = Math.max(offsetY, rect.y - 23);
              return (
                <Group key={`${annotation.id}:label`} listening={false}>
                  <Rect cornerRadius={3} fill={annotationColor(annotation.defect_type)} height={20} width={labelWidth} x={rect.x} y={y} />
                  <Text align="center" fill="#fff" fontSize={11} fontStyle="bold" height={20} padding={4} text={label} width={labelWidth} x={rect.x} y={y} />
                </Group>
              );
            })}
            {draftRect ? (
              <Rect
                listening={false}
                dash={[8 / zoom, 5 / zoom]}
                fill="rgba(22, 163, 74, 0.14)"
                height={draftRect.height}
                stroke="#16a34a"
                strokeScaleEnabled={false}
                strokeWidth={2}
                width={draftRect.width}
                x={draftRect.x}
                y={draftRect.y}
              />
            ) : null}
            {!readOnly && !drawingEnabled ? <Transformer ref={transformerRef} anchorSize={8 / zoom} borderStrokeWidth={1 / zoom} rotateEnabled={false} boundBoxFunc={(oldBox, newBox) => newBox.width < 12 || newBox.height < 12 ? oldBox : newBox} /> : null}
          </Layer>
          </Stage>
          <div className="annotation-canvas-zoom-status" aria-live="polite">
            {drawingEnabled
              ? "画框模式 · 按住并拖动"
              : `${Math.round(zoom * 100)}% · 滚轮缩放${zoom > MIN_CANVAS_ZOOM ? " · 拖动查看" : ""}`}
          </div>
        </>
      )}
    </div>
  );
}

function annotationsFromDefects(defects: ReportDefectSnapshot[], imageWidth: number, imageHeight: number): ManagedAnnotation[] {
  return defects.flatMap((defect, index) => {
    const raw = defect.bbox_json;
    let x = finiteNumber(raw?.x);
    let y = finiteNumber(raw?.y);
    let width = finiteNumber(raw?.width);
    let height = finiteNumber(raw?.height);
    if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) return [];
    if (x <= 1 && y <= 1 && width <= 1 && height <= 1) {
      x *= imageWidth;
      y *= imageHeight;
      width *= imageWidth;
      height *= imageHeight;
    }
    const confidence = finiteNumber(defect.confidence);
    const defectType = defect.defect_type || "crack";
    return [{
      id: `source:${defect.id || index}`,
      source_annotation_id: defect.id ?? null,
      defect_no: defect.defect_no || formatDefectNumber(defectType, index + 1),
      defect_type: defectType,
      confidence: confidence === null ? null : Math.min(1, Math.max(0, confidence)),
      bbox: roundedBBox({ x, y, width, height })
    }];
  });
}

function mergeDefectNumbers(
  annotations: ManagedAnnotation[],
  defects: ReportDefectSnapshot[]
): ManagedAnnotation[] {
  const defectNoById = new Map<string, string>();
  defects.forEach((defect) => {
    if (!defect.defect_no || !defect.id) return;
    defectNoById.set(String(defect.id), defect.defect_no);
    defectNoById.set(`source:${String(defect.id)}`, defect.defect_no);
  });
  return annotations.map((annotation, index) => ({
    ...annotation,
    defect_no: defectNoById.get(String(annotation.source_annotation_id || ""))
      || defectNoById.get(String(annotation.id))
      || annotation.defect_no
      || formatDefectNumber(annotation.defect_type, index + 1)
  }));
}

function buildAnnotationPhotoRows(report: ReportDetail): AnnotationPhotoRowData[] {
  const defectsByKey = new Map<string, ReportDefectSnapshot[]>();
  for (const defect of report.defects ?? []) {
    const photo = findPhoto(report.photos, defect);
    const key = photo ? photoGroupKey(photo) : defectGroupKey(defect);
    if (!key) continue;
    const group = defectsByKey.get(key) ?? [];
    group.push(defect);
    defectsByKey.set(key, group);
  }

  const consumed = new Set<string>();
  const rows = report.photos.map((photo, index) => {
    const key = photoGroupKey(photo) || `photo-index:${index}`;
    consumed.add(key);
    const defects = defectsByKey.get(key) ?? [];
    const modelOutput = report.raw_model_outputs.find((output) => photo.id && output.photo_id === photo.id)
      ?? report.raw_model_outputs.find((output) => photo.original_filename && output.filename === photo.original_filename);
    const firstFinding = defects[0]?.raw_result_json?.finding;
    return {
      key,
      filename: photo.original_filename || "检测结果照片",
      imageUrl: photo.preview_url
        || photo.thumbnail_url
        || defectImageUrl(defects)
        || "",
      imageWidth: finiteNumber(photo.image_width ?? modelOutput?.image_width ?? firstFinding?.image_width),
      imageHeight: finiteNumber(photo.image_height ?? modelOutput?.image_height ?? firstFinding?.image_height),
      tileWidth: modelOutput?.tile_width,
      tileHeight: modelOutput?.tile_height,
      tileOverlapRatio: modelOutput?.tile_overlap_ratio,
      detections: modelOutput?.detections,
      defects
    };
  });

  for (const [key, defects] of defectsByKey) {
    if (consumed.has(key) || !defects.length) continue;
    const finding = defects[0]?.raw_result_json?.finding;
    const modelOutput = report.raw_model_outputs.find((output) => (
      defects[0]?.photo_filename && output.filename === defects[0].photo_filename
    ));
    rows.push({
      key,
      filename: defects[0]?.photo_filename || "检测结果照片",
      imageUrl: defectImageUrl(defects),
      imageWidth: finiteNumber(finding?.image_width),
      imageHeight: finiteNumber(finding?.image_height),
      tileWidth: modelOutput?.tile_width,
      tileHeight: modelOutput?.tile_height,
      tileOverlapRatio: modelOutput?.tile_overlap_ratio,
      detections: modelOutput?.detections,
      defects
    });
  }
  return rows;
}

function defectImageUrl(defects: ReportDefectSnapshot[]) {
  const defect = defects.find((item) => item.photo_preview_url || item.photo_thumbnail_url);
  return defect?.photo_preview_url || defect?.photo_thumbnail_url || "";
}

function findPhoto(photos: ReportPhotoSnapshot[], defect: ReportDefectSnapshot) {
  return photos.find((photo) => defect.photo_id && photo.id === defect.photo_id)
    ?? photos.find((photo) => defect.photo_filename && photo.original_filename === defect.photo_filename);
}

function photoGroupKey(photo: ReportPhotoSnapshot) {
  if (photo.id) return `photo:${photo.id}`;
  if (photo.original_filename) return `filename:${photo.original_filename}`;
  return "";
}

function defectGroupKey(defect: ReportDefectSnapshot) {
  if (defect.photo_id) return `photo:${defect.photo_id}`;
  if (defect.photo_filename) return `filename:${defect.photo_filename}`;
  if (defect.id) return `defect:${defect.id}`;
  return "";
}
