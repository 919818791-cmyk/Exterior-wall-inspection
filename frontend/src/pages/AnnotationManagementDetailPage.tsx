import { Button, Card, CardBody, Skeleton } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type Konva from "konva";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheckBig,
  ClipboardCheck,
  CopyPlus,
  FileImage,
  Save,
  Tags,
  Trash2
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Image as KonvaImage, Layer, Rect, Stage, Text, Transformer } from "react-konva";
import {
  Link as RouterLink,
  Navigate,
  useBeforeUnload,
  useBlocker,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";

import {
  annotationResultQueryOptions,
  savePhotoAnnotations
} from "@/api/annotationManagement";
import {
  completeDetectionReview,
  reviewDetectionAnnotationsQueryOptions,
  saveReviewDetectionAnnotations
} from "@/api/review";
import type {
  AnnotationBBox,
  AnnotationPhotoEdit,
  AnnotationSourceType,
  ManagedAnnotation
} from "@/types/annotationManagement";
import type { ReportDefectSnapshot, ReportDetail, ReportPhotoSnapshot } from "@/types/reports";
import { createClientId } from "@/utils/id";

const DEFECT_OPTIONS = [
  { value: "crack", label: "裂缝", color: "#ef4444" },
  { value: "spalling", label: "剥落", color: "#f97316" },
  { value: "moisture", label: "潮湿", color: "#0ea5e9" },
  { value: "corrosion", label: "锈蚀", color: "#a16207" },
  { value: "hollow", label: "空鼓", color: "#7c3aed" }
] as const;

const DEFECT_LABELS = Object.fromEntries(DEFECT_OPTIONS.map((item) => [item.value, item.label]));
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
  defects: ReportDefectSnapshot[];
}

interface AnnotationEditorSaveStatus {
  dirty: boolean;
  isSaving: boolean;
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

function annotationLabel(defectType: string) {
  return DEFECT_LABELS[defectType] ?? defectType;
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

export function AnnotationManagementDetailPage() {
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  const sourceValue = searchParams.get("source_type");
  const sourceType: AnnotationSourceType = sourceValue === "formal" ? "formal" : "trial";

  if (sourceValue !== "formal" && sourceValue !== "trial") {
    return <Navigate replace to="/annotation-management" />;
  }

  return (
    <AnnotationResultWorkbench
      backLabel="返回列表"
      backTo="/annotation-management"
      pageTitle="标注管理"
      resultId={id}
      sourceType={sourceType}
    />
  );
}

export function AnnotationResultWorkbench({
  backLabel,
  backTo,
  pageTitle,
  projectName,
  resultId,
  reviewTaskId,
  sourceType
}: {
  backLabel: string;
  backTo: string;
  pageTitle: string;
  projectName?: string;
  resultId: string;
  reviewTaskId?: string;
  sourceType: AnnotationSourceType;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const detailQuery = useQuery(
    reviewTaskId
      ? reviewDetectionAnnotationsQueryOptions(reviewTaskId)
      : annotationResultQueryOptions(resultId, sourceType)
  );
  const rows = useMemo(
    () => detailQuery.data ? buildAnnotationPhotoRows(detailQuery.data.result) : [],
    [detailQuery.data]
  );
  const editsByPhoto = useMemo(
    () => new Map((detailQuery.data?.edits ?? []).map((edit) => [edit.photo_key, edit])),
    [detailQuery.data?.edits]
  );
  const [selectedPhotoKey, setSelectedPhotoKey] = useState<string | null>(null);
  const editorSaveHandlersRef = useRef(new Map<string, AnnotationEditorSaveHandler>());
  const [editorSaveStatuses, setEditorSaveStatuses] = useState<Record<string, AnnotationEditorSaveStatus>>({});

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
  const navigationBlocker = useBlocker(({ currentLocation, nextLocation }) => (
    hasUnsavedChanges
    && `${currentLocation.pathname}${currentLocation.search}` !== `${nextLocation.pathname}${nextLocation.search}`
  ));
  const warnBeforeUnload = useCallback((event: BeforeUnloadEvent) => {
    if (!hasUnsavedChanges) return;
    event.preventDefault();
    event.returnValue = "";
  }, [hasUnsavedChanges]);

  useBeforeUnload(warnBeforeUnload);

  useEffect(() => {
    if (navigationBlocker.state !== "blocked") return;
    if (window.confirm("当前有未保存的标注，离开页面后修改将丢失。确认离开？")) {
      navigationBlocker.proceed();
    } else {
      navigationBlocker.reset();
    }
  }, [navigationBlocker.state]);

  const completeMutation = useMutation({
    mutationFn: () => {
      if (!reviewTaskId) throw new Error("缺少检测任务。");
      return completeDetectionReview(reviewTaskId);
    },
    onSuccess: async (report) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["review"] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] })
      ]);
      navigate(`/reports/${report.id}?mode=review`);
    }
  });

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
            <RouterLink className="button secondary report-back-button" to={backTo}>
              <ChevronLeft aria-hidden="true" />
              <span>{backLabel}</span>
            </RouterLink>
          </CardBody>
        </Card>
      </div>
    );
  }

  const report = detailQuery.data.result;
  const readOnly = Boolean(reviewTaskId && report.status !== "draft");
  const activeSaveStatus = activePhotoKey ? editorSaveStatuses[activePhotoKey] : undefined;
  const saveActivePhoto = () => {
    if (!activePhotoKey || readOnly || !activeSaveStatus?.dirty || activeSaveStatus.isSaving) return;
    editorSaveHandlersRef.current.get(activePhotoKey)?.();
  };
  const completeReview = () => {
    if (!reviewTaskId || completeMutation.isPending) return;
    if (hasUnsavedChanges || isAnyEditorSaving) {
      window.alert("请先保存所有照片的标注，等待保存完成后再提交审核。");
      return;
    }
    if (!window.confirm("请确认所有需要调整的照片均已保存。完成审核后将生成项目正式报告，是否继续？")) {
      return;
    }
    completeMutation.mutate();
  };
  return (
    <div className="annotation-management-detail grid gap-5">
      {rows.length ? (
        <section className="annotation-detail-workbench" aria-label="照片标注编辑工作台">
          <header className="annotation-detail-header">
            <div className="management-page-title">
              {reviewTaskId
                ? <ClipboardCheck aria-hidden="true" className="management-page-title-icon" />
                : <Tags aria-hidden="true" className="management-page-title-icon" />}
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
              {reviewTaskId ? (
                <button
                  className="button primary annotation-complete-review"
                  disabled={readOnly || hasUnsavedChanges || isAnyEditorSaving || completeMutation.isPending}
                  type="button"
                  onClick={completeReview}
                >
                  <CircleCheckBig aria-hidden="true" />
                  {readOnly
                    ? "审核已完成"
                    : hasUnsavedChanges || isAnyEditorSaving
                      ? "请先保存标注"
                      : completeMutation.isPending
                        ? "正在生成报告…"
                        : "完成审核"}
                </button>
              ) : null}
              <button
                className="button primary annotation-save-annotations"
                disabled={readOnly || !activeSaveStatus?.dirty || activeSaveStatus.isSaving}
                type="button"
                onClick={saveActivePhoto}
              >
                <Save aria-hidden="true" />
                {activeSaveStatus?.isSaving ? "保存中…" : "保存标注"}
              </button>
              <RouterLink className="button secondary report-back-button annotation-back-link" to={backTo}>
                <ChevronLeft aria-hidden="true" />
                <span>{backLabel}</span>
              </RouterLink>
            </div>
          </header>

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
                    resultId={resultId}
                    reviewTaskId={reviewTaskId}
                    row={row}
                    sourceType={sourceType}
                    onRegisterSaveHandler={registerEditorSaveHandler}
                    onSaveStatusChange={updateEditorSaveStatus}
                    onSelectPhoto={selectPhoto}
                  />
                </div>
              ))}
            </div>
          </div>
          {completeMutation.isError ? (
            <p className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 shadow-lg">
              {errorMessage(completeMutation.error)}
            </p>
          ) : null}
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
  resultId,
  reviewTaskId,
  row,
  sourceType,
  onRegisterSaveHandler,
  onSaveStatusChange,
  onSelectPhoto
}: {
  edit?: AnnotationPhotoEdit;
  photoCount: number;
  photoIndex: number;
  readOnly: boolean;
  resultId: string;
  reviewTaskId?: string;
  row: AnnotationPhotoRowData;
  sourceType: AnnotationSourceType;
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
  const savedAnnotations = edit?.annotations ?? originalAnnotations;
  const [annotations, setAnnotations] = useState<ManagedAnnotation[]>(savedAnnotations);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [touched, setTouched] = useState(false);
  const [message, setMessage] = useState("");

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
  const dirty = JSON.stringify(cleanAnnotations(annotations)) !== JSON.stringify(cleanAnnotations(savedAnnotations));
  const defectOptions = reviewTaskId
    ? DEFECT_OPTIONS.filter((option) => ["crack", "spalling", "hollow"].includes(option.value))
    : DEFECT_OPTIONS;

  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["annotation-management"] }),
    queryClient.invalidateQueries({ queryKey: ["review", "detections"] })
  ]);
  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        photo_key: row.key,
        annotations: cleanAnnotations(annotations)
      };
      return reviewTaskId
        ? saveReviewDetectionAnnotations(reviewTaskId, payload)
        : savePhotoAnnotations(resultId, sourceType, payload);
    },
    onSuccess: async () => {
      setTouched(false);
      setMessage("标注已保存。");
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
    setAnnotations((current) => current.map((item) => item.id === annotationId ? { ...item, ...patch } : item));
    setSelectedId(annotationId);
    setTouched(true);
    setMessage("");
  }

  function createAnnotation(bbox: AnnotationBBox) {
    if (readOnly) return;
    const annotation: ManagedAnnotation = {
      id: createClientId("annotation"),
      source_annotation_id: null,
      defect_type: "crack",
      confidence: null,
      bbox: roundedBBox(bbox)
    };
    setAnnotations((current) => [...current, annotation]);
    setSelectedId(annotation.id);
    setIsDrawing(false);
    setTouched(true);
    setMessage("");
  }

  function toggleDrawing() {
    if (readOnly) return;
    setIsDrawing((current) => {
      const next = !current;
      if (next) setSelectedId(null);
      return next;
    });
    setMessage("");
  }

  function deleteSelected() {
    if (!selected || readOnly) return;
    setAnnotations((current) => current.filter((item) => item.id !== selected.id));
    setSelectedId(null);
    setTouched(true);
    setMessage("");
  }

  const activeError = saveMutation.error;
  return (
    <div className="annotation-photo-editor-module">
      {activeError ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{errorMessage(activeError)}</p> : null}
      {message ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">{message}</p> : null}

      <AnnotationColumn title={row.filename}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            aria-pressed={isDrawing}
            className={`annotation-action-button rounded-lg border border-green-600 font-bold shadow-none transition-colors data-[hover=true]:!bg-green-600 data-[hover=true]:!text-white ${isDrawing ? "bg-green-600 text-white" : "bg-white text-green-600"}`}
            size="sm"
            isDisabled={readOnly}
            startContent={<CopyPlus className="h-4 w-4" aria-hidden="true" />}
            variant="flat"
            onPress={toggleDrawing}
          >
            {isDrawing ? "取消画框" : "新增标注"}
          </Button>
          <Button className="annotation-action-button rounded-lg border border-red-200 bg-white font-bold text-red-600 shadow-none transition-colors data-[hover=true]:!bg-red-600 data-[hover=true]:!text-white" isDisabled={!selected || readOnly} size="sm" startContent={<Trash2 className="h-4 w-4" aria-hidden="true" />} variant="flat" onPress={deleteSelected}>删除标注</Button>
          <p className="min-w-0 text-sm font-bold text-slate-500" aria-live="polite">
            {isDrawing ? (
              <strong className="text-green-700">请在照片上按住鼠标并拖动绘制标注框，按 Esc 可取消</strong>
            ) : (
              <>
                当前选中的标注框：
                <strong className="text-slate-800">
                  {selected && selectedIndex >= 0
                    ? `#${selectedIndex + 1} ${annotationLabel(selected.defect_type)}`
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
    </div>
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
              const label = `${index + 1} ${annotationLabel(annotation.defect_type)}`;
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
    return [{
      id: `source:${defect.id || index}`,
      source_annotation_id: defect.id ?? null,
      defect_type: defect.defect_type || "crack",
      confidence: confidence === null ? null : Math.min(1, Math.max(0, confidence)),
      bbox: roundedBBox({ x, y, width, height })
    }];
  });
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
      defects
    };
  });

  for (const [key, defects] of defectsByKey) {
    if (consumed.has(key) || !defects.length) continue;
    const finding = defects[0]?.raw_result_json?.finding;
    rows.push({
      key,
      filename: defects[0]?.photo_filename || "检测结果照片",
      imageUrl: defectImageUrl(defects),
      imageWidth: finiteNumber(finding?.image_width),
      imageHeight: finiteNumber(finding?.image_height),
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
