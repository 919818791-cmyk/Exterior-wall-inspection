import {
  Button,
  Card,
  CardBody,
  Divider,
  Skeleton,
  Textarea
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type Konva from "konva";
import {
  ArrowLeft,
  Check,
  ClipboardCheck,
  CopyPlus,
  FileText,
  RefreshCcw,
  Save,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Group, Image as KonvaImage, Layer, Rect, Stage, Text, Transformer } from "react-konva";
import { Link as RouterLink, useParams } from "react-router-dom";

import {
  completeProjectReview,
  createReviewResult,
  deleteReviewResult,
  reviewProjectResultsQueryOptions,
  updateReviewResult
} from "@/api/review";
import { StatusPill } from "@/components/StatusPill";
import type { DefectType } from "@/types/projects";
import type {
  AiDetectionResult,
  ReviewBBox,
  ReviewPhoto,
  ReviewResult,
  ReviewResultCreatePayload,
  ReviewResultStatus
} from "@/types/review";
import { formatDateTime, formatLocation } from "@/utils/projectDisplay";

const NEW_ANNOTATION_KEY = "new:manual";

const DEFECT_OPTIONS: Array<{ value: DefectType; label: string; color: string }> = [
  { value: "crack", label: "裂缝", color: "#ef4444" },
  { value: "spalling", label: "剥落", color: "#f97316" },
  { value: "hollowing", label: "空鼓", color: "#8b5cf6" },
  { value: "leakage", label: "渗漏", color: "#0ea5e9" },
  { value: "corrosion", label: "锈蚀", color: "#a16207" }
];

const DEFECT_LABELS = Object.fromEntries(
  DEFECT_OPTIONS.map((option) => [option.value, option.label])
) as Record<DefectType, string>;

const DEFECT_COLORS = Object.fromEntries(
  DEFECT_OPTIONS.map((option) => [option.value, option.color])
) as Record<DefectType, string>;

const REVIEW_STATUS_LABELS: Record<ReviewResultStatus | "ai_pending", string> = {
  pending: "待处理",
  confirmed: "已确认",
  modified: "已修改",
  deleted: "已删除",
  added: "人工新增",
  ai_pending: "AI原始"
};

const REVIEW_STATUS_TONES: Record<ReviewResultStatus | "ai_pending", "success" | "warning" | "danger"> = {
  pending: "warning",
  confirmed: "success",
  modified: "warning",
  deleted: "danger",
  added: "success",
  ai_pending: "warning"
};

interface AnnotationDraft {
  defect_type: DefectType;
  bbox: ReviewBBox;
  severity: string;
  review_note: string;
}

interface ManualAnnotation {
  photoId: string;
  bbox: ReviewBBox;
  defect_type: DefectType;
  severity: string;
  review_note: string;
}

interface ReviewAnnotation {
  key: string;
  photoId: string;
  aiResult: AiDetectionResult | null;
  reviewResult: ReviewResult | null;
  bbox: ReviewBBox;
  defect_type: DefectType;
  severity: string | null;
  status: ReviewResultStatus | "ai_pending";
  confidence: string | null;
  modelVersion: string | null;
  source: "ai" | "review" | "manual-new";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function normalizeBBox(value: Partial<ReviewBBox> | Record<string, unknown>): ReviewBBox {
  return {
    x: Math.max(0, Number(value.x) || 0),
    y: Math.max(0, Number(value.y) || 0),
    width: Math.max(4, Number(value.width) || 80),
    height: Math.max(4, Number(value.height) || 60)
  };
}

function draftFromAnnotation(annotation: ReviewAnnotation): AnnotationDraft {
  return {
    defect_type: annotation.defect_type,
    bbox: annotation.bbox,
    severity: annotation.severity ?? "",
    review_note: annotation.reviewResult?.review_note ?? ""
  };
}

function bboxPayload(bbox: ReviewBBox): ReviewBBox {
  return {
    x: Math.round(bbox.x * 100) / 100,
    y: Math.round(bbox.y * 100) / 100,
    width: Math.round(Math.max(4, bbox.width) * 100) / 100,
    height: Math.round(Math.max(4, bbox.height) * 100) / 100
  };
}

function confidenceText(value: string | null) {
  if (!value) return "-";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric * 100)}%` : value;
}

function useCanvasImage(src: string | null | undefined) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setImage(null);
    setFailed(false);
    if (!src) return;

    let cancelled = false;
    const nextImage = new window.Image();
    nextImage.onload = () => {
      if (!cancelled) setImage(nextImage);
    };
    nextImage.onerror = () => {
      if (!cancelled) setFailed(true);
    };
    nextImage.src = src;

    return () => {
      cancelled = true;
    };
  }, [src]);

  return { image, failed };
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(ref.current);
    setWidth(ref.current.clientWidth);

    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

export function ReviewProjectDetailPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const resultsQuery = useQuery(reviewProjectResultsQueryOptions(id));
  const data = resultsQuery.data;
  const project = data?.project;
  const canEdit = project?.status === "pending_review";

  const [selectedPhotoId, setSelectedPhotoId] = useState<string>("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<AnnotationDraft | null>(null);
  const [manualAnnotation, setManualAnnotation] = useState<ManualAnnotation | null>(null);
  const [message, setMessage] = useState("");

  const selectedPhoto = useMemo(
    () => data?.photos.find((photo) => photo.id === selectedPhotoId) ?? data?.photos[0] ?? null,
    [data?.photos, selectedPhotoId]
  );

  useEffect(() => {
    if (!selectedPhotoId && data?.photos[0]) {
      setSelectedPhotoId(data.photos[0].id);
    }
  }, [data?.photos, selectedPhotoId]);

  useEffect(() => {
    setSelectedKey(null);
    setDraft(null);
    setManualAnnotation(null);
  }, [selectedPhotoId]);

  const reviewByAiId = useMemo(() => {
    const entries = (data?.review_results ?? [])
      .filter((result) => result.ai_result_id)
      .map((result) => [result.ai_result_id as string, result] as const);
    return new Map(entries);
  }, [data?.review_results]);

  const annotations = useMemo<ReviewAnnotation[]>(() => {
    if (!selectedPhoto || !data) return [];

    const aiAnnotations = data.ai_results
      .filter((result) => result.photo_id === selectedPhoto.id)
      .map((result) => {
        const reviewResult = reviewByAiId.get(result.id) ?? null;
        return {
          key: reviewResult ? `review:${reviewResult.id}` : `ai:${result.id}`,
          photoId: result.photo_id,
          aiResult: result,
          reviewResult,
          bbox: normalizeBBox(reviewResult?.bbox_json ?? result.bbox_json),
          defect_type: reviewResult?.defect_type ?? result.defect_type,
          severity: reviewResult?.severity ?? result.severity,
          status: reviewResult?.status ?? "ai_pending",
          confidence: result.confidence,
          modelVersion: result.model_version,
          source: reviewResult ? "review" : "ai"
        } satisfies ReviewAnnotation;
      });

    const manualReviewAnnotations = data.review_results
      .filter((result) => result.photo_id === selectedPhoto.id && result.ai_result_id === null)
      .map((result) => ({
        key: `review:${result.id}`,
        photoId: result.photo_id,
        aiResult: null,
        reviewResult: result,
        bbox: normalizeBBox(result.bbox_json),
        defect_type: result.defect_type,
        severity: result.severity,
        status: result.status,
        confidence: null,
        modelVersion: null,
        source: "review" as const
      }));

    const newAnnotation = manualAnnotation && manualAnnotation.photoId === selectedPhoto.id
      ? [
          {
            key: NEW_ANNOTATION_KEY,
            photoId: manualAnnotation.photoId,
            aiResult: null,
            reviewResult: null,
            bbox: manualAnnotation.bbox,
            defect_type: manualAnnotation.defect_type,
            severity: manualAnnotation.severity,
            status: "added" as const,
            confidence: null,
            modelVersion: null,
            source: "manual-new" as const
          }
        ]
      : [];

    return [...aiAnnotations, ...manualReviewAnnotations, ...newAnnotation];
  }, [data, manualAnnotation, reviewByAiId, selectedPhoto]);

  const selectedAnnotation = useMemo(
    () => annotations.find((annotation) => annotation.key === selectedKey) ?? null,
    [annotations, selectedKey]
  );

  useEffect(() => {
    if (!annotations.length) {
      setSelectedKey(null);
      setDraft(null);
      return;
    }
    if (selectedKey && annotations.some((annotation) => annotation.key === selectedKey)) return;
    const firstVisible = annotations.find((annotation) => annotation.status !== "deleted") ?? annotations[0];
    setSelectedKey(firstVisible.key);
    setDraft(draftFromAnnotation(firstVisible));
  }, [annotations, selectedKey]);

  const invalidateReview = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["review"] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] })
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: async ({
      annotation,
      nextDraft,
      status
    }: {
      annotation: ReviewAnnotation;
      nextDraft: AnnotationDraft;
      status: Exclude<ReviewResultStatus, "pending">;
    }) => {
      const payload: ReviewResultCreatePayload = {
        defect_type: nextDraft.defect_type,
        bbox: bboxPayload(nextDraft.bbox),
        severity: nextDraft.severity.trim() || null,
        status,
        review_note: nextDraft.review_note.trim() || null
      };

      if (annotation.source === "manual-new") {
        if (!project || !selectedPhoto) throw new Error("缺少项目或照片信息。");
        return createReviewResult({
          ...payload,
          project_id: project.id,
          photo_id: selectedPhoto.id,
          status: "added"
        });
      }

      if (annotation.reviewResult) {
        return updateReviewResult(annotation.reviewResult.id, payload);
      }

      if (!annotation.aiResult) throw new Error("缺少 AI 原始结果。");
      return createReviewResult({
        ...payload,
        ai_result_id: annotation.aiResult.id
      });
    },
    onSuccess: async () => {
      setMessage("审核结果已保存。");
      setManualAnnotation(null);
      await invalidateReview();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (annotation: ReviewAnnotation) => {
      if (annotation.source === "manual-new") {
        return null;
      }
      if (annotation.reviewResult) {
        return deleteReviewResult(annotation.reviewResult.id);
      }
      if (!annotation.aiResult) throw new Error("缺少 AI 原始结果。");
      return createReviewResult({
        ai_result_id: annotation.aiResult.id,
        defect_type: annotation.defect_type,
        bbox: bboxPayload(annotation.bbox),
        severity: annotation.severity,
        status: "deleted",
        review_note: "删除误检缺陷"
      });
    },
    onSuccess: async () => {
      setMessage("缺陷框已标记为删除。");
      setManualAnnotation(null);
      await invalidateReview();
    }
  });

  const completeMutation = useMutation({
    mutationFn: () => completeProjectReview(id),
    onSuccess: async (report) => {
      setMessage(`审核完成，已生成报告 ${report.report_no}。`);
      await invalidateReview();
    }
  });

  const activeError = saveMutation.error ?? deleteMutation.error ?? completeMutation.error;

  const selectAnnotation = (annotation: ReviewAnnotation) => {
    setSelectedKey(annotation.key);
    setDraft(draftFromAnnotation(annotation));
    setMessage("");
  };

  const updateDraft = (patch: Partial<AnnotationDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setMessage("");
  };

  const updateDraftBBox = (annotation: ReviewAnnotation, bbox: ReviewBBox) => {
    if (annotation.key !== selectedKey) {
      setSelectedKey(annotation.key);
    }
    setDraft((current) => ({
      ...(current ?? draftFromAnnotation(annotation)),
      bbox
    }));
    if (annotation.source === "manual-new") {
      setManualAnnotation((current) =>
        current ? { ...current, bbox } : current
      );
    }
  };

  const addManualAnnotation = () => {
    if (!selectedPhoto || !project) return;
    const imageWidth = selectedPhoto.image_width ?? 1200;
    const imageHeight = selectedPhoto.image_height ?? 800;
    const next: ManualAnnotation = {
      photoId: selectedPhoto.id,
      defect_type: "crack",
      severity: "medium",
      review_note: "",
      bbox: {
        x: Math.round(imageWidth * 0.34),
        y: Math.round(imageHeight * 0.32),
        width: Math.round(imageWidth * 0.22),
        height: Math.round(imageHeight * 0.18)
      }
    };
    setManualAnnotation(next);
    setSelectedKey(NEW_ANNOTATION_KEY);
    setDraft({
      defect_type: next.defect_type,
      severity: next.severity,
      review_note: next.review_note,
      bbox: next.bbox
    });
  };

  const saveSelected = (status: Exclude<ReviewResultStatus, "pending">) => {
    if (!selectedAnnotation || !draft) return;
    saveMutation.mutate({
      annotation: selectedAnnotation,
      nextDraft: draft,
      status: selectedAnnotation.source === "manual-new" ? "added" : status
    });
  };

  const deleteSelected = () => {
    if (!selectedAnnotation) return;
    if (selectedAnnotation.source === "manual-new") {
      setManualAnnotation(null);
      setSelectedKey(null);
      setDraft(null);
      return;
    }
    const confirmed = window.confirm("确认将该缺陷框标记为删除？AI 原始结果会保留。");
    if (!confirmed) return;
    deleteMutation.mutate(selectedAnnotation);
  };

  const completeReview = () => {
    const confirmed = window.confirm("确认完成审核并生成报告记录？完成后项目会进入已审核状态。");
    if (!confirmed) return;
    completeMutation.mutate();
  };

  if (resultsQuery.isLoading) {
    return (
      <div className="grid gap-5">
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-[520px] rounded-lg" />
      </div>
    );
  }

  if (resultsQuery.isError || !data || !project) {
    return (
      <div className="grid min-h-[calc(100svh-8rem)] place-items-center">
        <Card className="w-full max-w-2xl rounded-lg border border-red-200 shadow-none">
          <CardBody className="gap-4 p-6">
            <h1 className="text-xl font-black text-ink">审核详情加载失败</h1>
            <p className="text-sm font-bold text-red-700">
              {getErrorMessage(resultsQuery.error)}
            </p>
            <Button
              as={RouterLink}
              className="w-fit rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
              to="/review"
              variant="flat"
            >
              返回审核工作台
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-5 pb-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase text-action">Review Detail</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-black text-ink">{project.name}</h1>
            <StatusPill tone={project.status === "pending_review" ? "warning" : "success"}>
              {project.status === "pending_review" ? "待审核" : "只读"}
            </StatusPill>
          </div>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-7 text-slate-600">
            {formatLocation(project)} · {project.project_no}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            as={RouterLink}
            className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
            startContent={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
            to="/review"
            variant="flat"
          >
            返回工作台
          </Button>
          <Button
            className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
            isLoading={resultsQuery.isFetching}
            startContent={<RefreshCcw className="h-4 w-4" aria-hidden="true" />}
            variant="flat"
            onPress={() => void resultsQuery.refetch()}
          >
            刷新
          </Button>
          <Button
            className="rounded-lg font-bold"
            color="primary"
            isDisabled={!canEdit || completeMutation.isPending}
            isLoading={completeMutation.isPending}
            startContent={<FileText className="h-4 w-4" aria-hidden="true" />}
            onPress={completeReview}
          >
            完成审核
          </Button>
        </div>
      </section>

      {!canEdit ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
          当前项目不是待审核状态，审核结果只读展示。
        </div>
      ) : null}

      {activeError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {getErrorMessage(activeError)}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          {message}
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-4">
        <MetricBlock label="照片" value={String(data.photos.length)} />
        <MetricBlock label="AI缺陷" value={String(data.ai_results.length)} />
        <MetricBlock label="审核记录" value={String(data.review_results.length)} />
        <MetricBlock label="更新时间" value={formatDateTime(project.updated_at)} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_340px]">
        <PhotoRail
          photos={data.photos}
          selectedPhotoId={selectedPhoto?.id ?? ""}
          aiResults={data.ai_results}
          reviewResults={data.review_results}
          onSelect={(photoId) => setSelectedPhotoId(photoId)}
        />

        <Card className="rounded-lg border border-slate-200 shadow-none">
          <CardBody className="gap-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-ink">缺陷框标注</h2>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  {selectedPhoto?.original_filename ?? "未选择照片"}
                </p>
              </div>
              <Button
                className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
                isDisabled={!canEdit || !selectedPhoto}
                size="sm"
                startContent={<CopyPlus className="h-4 w-4" aria-hidden="true" />}
                variant="flat"
                onPress={addManualAnnotation}
              >
                新增漏检
              </Button>
            </div>

            {selectedPhoto ? (
              <ReviewCanvas
                annotations={annotations}
                canEdit={canEdit}
                draft={draft}
                selectedKey={selectedKey}
                selectedPhoto={selectedPhoto}
                onSelect={selectAnnotation}
                onUpdateBBox={updateDraftBBox}
              />
            ) : (
              <div className="grid min-h-[460px] place-items-center rounded-lg border border-slate-200 bg-slate-50 text-sm font-bold text-slate-500">
                暂无照片
              </div>
            )}
          </CardBody>
        </Card>

        <ResultInspector
          annotation={selectedAnnotation}
          canEdit={canEdit}
          draft={draft}
          isDeleting={deleteMutation.isPending}
          isSaving={saveMutation.isPending}
          onDelete={deleteSelected}
          onSave={saveSelected}
          onUpdateDraft={updateDraft}
        />
      </section>
    </div>
  );
}

function PhotoRail({
  photos,
  selectedPhotoId,
  aiResults,
  reviewResults,
  onSelect
}: {
  photos: ReviewPhoto[];
  selectedPhotoId: string;
  aiResults: AiDetectionResult[];
  reviewResults: ReviewResult[];
  onSelect: (photoId: string) => void;
}) {
  const countByPhoto = useMemo(() => {
    const counts = new Map<string, { ai: number; review: number }>();
    photos.forEach((photo) => counts.set(photo.id, { ai: 0, review: 0 }));
    aiResults.forEach((result) => {
      const current = counts.get(result.photo_id) ?? { ai: 0, review: 0 };
      counts.set(result.photo_id, { ...current, ai: current.ai + 1 });
    });
    reviewResults.forEach((result) => {
      const current = counts.get(result.photo_id) ?? { ai: 0, review: 0 };
      counts.set(result.photo_id, { ...current, review: current.review + 1 });
    });
    return counts;
  }, [aiResults, photos, reviewResults]);

  return (
    <Card className="rounded-lg border border-slate-200 shadow-none">
      <CardBody className="gap-0 p-0">
        <div className="px-4 py-4">
          <h2 className="text-lg font-black text-ink">照片列表</h2>
          <p className="mt-1 text-xs font-bold text-slate-500">按照片复核 AI 结果。</p>
        </div>
        <Divider />
        <div className="grid max-h-[680px] gap-2 overflow-auto p-3">
          {photos.length ? (
            photos.map((photo, index) => {
              const counts = countByPhoto.get(photo.id) ?? { ai: 0, review: 0 };
              const selected = selectedPhotoId === photo.id;
              return (
                <button
                  key={photo.id}
                  className={`rounded-lg border p-2 text-left transition ${
                    selected
                      ? "border-action bg-action-soft"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                  type="button"
                  onClick={() => onSelect(photo.id)}
                >
                  <div className="aspect-[4/3] overflow-hidden rounded-md bg-slate-100">
                    {photo.thumbnail_url ? (
                      <img
                        alt=""
                        className="h-full w-full object-cover"
                        src={photo.thumbnail_url}
                      />
                    ) : null}
                  </div>
                  <p className="mt-2 truncate text-sm font-black text-ink">
                    {index + 1}. {photo.original_filename}
                  </p>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    AI {counts.ai} · 审核 {counts.review}
                  </p>
                </button>
              );
            })
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-8 text-center text-sm font-bold text-slate-500">
              暂无照片
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function ReviewCanvas({
  annotations,
  canEdit,
  draft,
  selectedKey,
  selectedPhoto,
  onSelect,
  onUpdateBBox
}: {
  annotations: ReviewAnnotation[];
  canEdit: boolean;
  draft: AnnotationDraft | null;
  selectedKey: string | null;
  selectedPhoto: ReviewPhoto;
  onSelect: (annotation: ReviewAnnotation) => void;
  onUpdateBBox: (annotation: ReviewAnnotation, bbox: ReviewBBox) => void;
}) {
  const [containerRef, containerWidth] = useElementWidth<HTMLDivElement>();
  const selectedShapeRef = useRef<Konva.Rect | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const { image, failed } = useCanvasImage(selectedPhoto.preview_url);

  const naturalWidth = selectedPhoto.image_width ?? image?.naturalWidth ?? 1200;
  const naturalHeight = selectedPhoto.image_height ?? image?.naturalHeight ?? 800;
  const stageWidth = Math.max(320, Math.min(containerWidth || 860, 980));
  const maxImageHeight = 560;
  const scale = Math.min(stageWidth / naturalWidth, maxImageHeight / naturalHeight);
  const imageWidth = Math.max(1, naturalWidth * scale);
  const imageHeight = Math.max(1, naturalHeight * scale);
  const offsetX = Math.max(0, (stageWidth - imageWidth) / 2);
  const offsetY = 18;
  const stageHeight = imageHeight + offsetY * 2;

  const displayAnnotations = useMemo(
    () =>
      annotations.map((annotation) =>
        annotation.key === selectedKey && draft
          ? {
              ...annotation,
              bbox: draft.bbox,
              defect_type: draft.defect_type,
              severity: draft.severity
            }
          : annotation
      ),
    [annotations, draft, selectedKey]
  );

  useEffect(() => {
    if (!transformerRef.current) return;
    if (selectedKey && selectedShapeRef.current && canEdit) {
      transformerRef.current.nodes([selectedShapeRef.current]);
    } else {
      transformerRef.current.nodes([]);
    }
    transformerRef.current.getLayer()?.batchDraw();
  }, [canEdit, displayAnnotations, selectedKey]);

  const toStageRect = (bbox: ReviewBBox) => ({
    x: offsetX + bbox.x * scale,
    y: offsetY + bbox.y * scale,
    width: bbox.width * scale,
    height: bbox.height * scale
  });

  const toImageRect = (rect: ReviewBBox) => ({
    x: Math.max(0, (rect.x - offsetX) / scale),
    y: Math.max(0, (rect.y - offsetY) / scale),
    width: Math.max(4, rect.width / scale),
    height: Math.max(4, rect.height / scale)
  });

  return (
    <div ref={containerRef} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
      {!selectedPhoto.preview_url ? (
        <div className="grid min-h-[460px] place-items-center text-sm font-bold text-slate-500">
          照片没有可预览地址
        </div>
      ) : failed ? (
        <div className="grid min-h-[460px] place-items-center text-sm font-bold text-red-600">
          图片加载失败，请检查 MinIO 访问地址。
        </div>
      ) : (
        <Stage width={stageWidth} height={stageHeight}>
          <Layer>
            {image ? (
              <KonvaImage
                image={image}
                x={offsetX}
                y={offsetY}
                width={imageWidth}
                height={imageHeight}
              />
            ) : (
              <Rect
                fill="#e2e8f0"
                height={imageHeight}
                width={imageWidth}
                x={offsetX}
                y={offsetY}
              />
            )}
            {displayAnnotations
              .filter((annotation) => annotation.status !== "deleted")
              .map((annotation) => {
                const rect = toStageRect(annotation.bbox);
                const selected = annotation.key === selectedKey;
                const stroke = DEFECT_COLORS[annotation.defect_type];
                return (
                  <Rect
                    key={annotation.key}
                    ref={(node) => {
                      if (selected) selectedShapeRef.current = node;
                    }}
                    dash={annotation.status === "ai_pending" ? [8, 4] : undefined}
                    draggable={canEdit && selected}
                    fill={selected ? `${stroke}22` : `${stroke}12`}
                    height={rect.height}
                    stroke={stroke}
                    strokeWidth={selected ? 3 : 2}
                    width={rect.width}
                    x={rect.x}
                    y={rect.y}
                    onClick={() => onSelect(annotation)}
                    onDragEnd={(event) => {
                      onUpdateBBox(
                        annotation,
                        toImageRect({
                          x: event.target.x(),
                          y: event.target.y(),
                          width: rect.width,
                          height: rect.height
                        })
                      );
                    }}
                    onDragStart={() => onSelect(annotation)}
                    onTap={() => onSelect(annotation)}
                    onTransformEnd={(event) => {
                      const node = event.target;
                      const scaleX = node.scaleX();
                      const scaleY = node.scaleY();
                      node.scaleX(1);
                      node.scaleY(1);
                      onUpdateBBox(
                        annotation,
                        toImageRect({
                          x: node.x(),
                          y: node.y(),
                          width: Math.max(6, node.width() * scaleX),
                          height: Math.max(6, node.height() * scaleY)
                        })
                      );
                    }}
                  />
                );
              })}
            {displayAnnotations
              .filter((annotation) => annotation.status !== "deleted")
              .map((annotation, index) => {
                const rect = toStageRect(annotation.bbox);
                const label = `${index + 1} ${DEFECT_LABELS[annotation.defect_type]}`;
                const labelWidth = Math.max(68, label.length * 13);
                const labelY = Math.max(offsetY, rect.y - 26);
                return (
                  <Group key={`${annotation.key}:label-group`}>
                    <Rect
                      cornerRadius={4}
                      fill={DEFECT_COLORS[annotation.defect_type]}
                      height={22}
                      listening={false}
                      width={labelWidth}
                      x={rect.x}
                      y={labelY}
                    />
                    <Text
                      align="center"
                      fill="#ffffff"
                      fontSize={12}
                      fontStyle="bold"
                      height={22}
                      listening={false}
                      padding={5}
                      text={label}
                      verticalAlign="middle"
                      width={labelWidth}
                      x={rect.x}
                      y={labelY}
                    />
                  </Group>
                );
              })}
            <Transformer
              ref={transformerRef}
              boundBoxFunc={(oldBox, newBox) =>
                newBox.width < 12 || newBox.height < 12 ? oldBox : newBox
              }
              rotateEnabled={false}
            />
          </Layer>
        </Stage>
      )}
    </div>
  );
}

function ResultInspector({
  annotation,
  canEdit,
  draft,
  isDeleting,
  isSaving,
  onDelete,
  onSave,
  onUpdateDraft
}: {
  annotation: ReviewAnnotation | null;
  canEdit: boolean;
  draft: AnnotationDraft | null;
  isDeleting: boolean;
  isSaving: boolean;
  onDelete: () => void;
  onSave: (status: Exclude<ReviewResultStatus, "pending">) => void;
  onUpdateDraft: (patch: Partial<AnnotationDraft>) => void;
}) {
  const isManualNew = annotation?.source === "manual-new";
  const isDeleted = annotation?.status === "deleted";

  return (
    <Card className="rounded-lg border border-slate-200 shadow-none">
      <CardBody className="gap-4 p-4">
        <div>
          <h2 className="text-lg font-black text-ink">结果检查器</h2>
          <p className="mt-1 text-xs font-bold text-slate-500">
            选中缺陷框后确认、修正或删除。
          </p>
        </div>
        <Divider />

        {!annotation || !draft ? (
          <div className="grid min-h-72 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-center">
            <div>
              <ClipboardCheck className="mx-auto h-8 w-8 text-action" aria-hidden="true" />
              <p className="mt-3 text-sm font-bold text-slate-500">请选择一个缺陷框</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusPill tone={REVIEW_STATUS_TONES[annotation.status]}>
                {REVIEW_STATUS_LABELS[annotation.status]}
              </StatusPill>
              <span className="text-xs font-bold text-slate-500">
                置信度 {confidenceText(annotation.confidence)}
              </span>
            </div>

            <div className="grid gap-3">
              <label className="grid gap-1 text-sm font-bold text-slate-700">
                缺陷类型
                <select
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-ink outline-none focus:border-action"
                  disabled={!canEdit || isDeleted}
                  value={draft.defect_type}
                  onChange={(event) =>
                    onUpdateDraft({ defect_type: event.target.value as DefectType })
                  }
                >
                  {DEFECT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  isDisabled={!canEdit || isDeleted}
                  label="X"
                  value={draft.bbox.x}
                  onChange={(value) => onUpdateDraft({ bbox: { ...draft.bbox, x: value } })}
                />
                <NumberField
                  isDisabled={!canEdit || isDeleted}
                  label="Y"
                  value={draft.bbox.y}
                  onChange={(value) => onUpdateDraft({ bbox: { ...draft.bbox, y: value } })}
                />
                <NumberField
                  isDisabled={!canEdit || isDeleted}
                  label="宽"
                  value={draft.bbox.width}
                  onChange={(value) => onUpdateDraft({ bbox: { ...draft.bbox, width: value } })}
                />
                <NumberField
                  isDisabled={!canEdit || isDeleted}
                  label="高"
                  value={draft.bbox.height}
                  onChange={(value) => onUpdateDraft({ bbox: { ...draft.bbox, height: value } })}
                />
              </div>

              <label className="grid gap-1 text-sm font-bold text-slate-700">
                严重程度
                <select
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-ink outline-none focus:border-action"
                  disabled={!canEdit || isDeleted}
                  value={draft.severity}
                  onChange={(event) => onUpdateDraft({ severity: event.target.value })}
                >
                  <option value="">未标注</option>
                  <option value="low">轻微</option>
                  <option value="medium">中等</option>
                  <option value="high">严重</option>
                </select>
              </label>

              <Textarea
                isDisabled={!canEdit || isDeleted}
                classNames={{ inputWrapper: "rounded-lg shadow-none" }}
                label="审核备注"
                minRows={3}
                value={draft.review_note}
                onValueChange={(value) => onUpdateDraft({ review_note: value })}
              />
            </div>

            <Divider />

            <div className="grid gap-2">
              {isManualNew ? (
                <Button
                  className="rounded-lg font-bold"
                  color="primary"
                  isDisabled={!canEdit}
                  isLoading={isSaving}
                  startContent={<Save className="h-4 w-4" aria-hidden="true" />}
                  onPress={() => onSave("added")}
                >
                  保存新增漏检
                </Button>
              ) : (
                <>
                  <Button
                    className="rounded-lg font-bold"
                    color="primary"
                    isDisabled={!canEdit || isDeleted}
                    isLoading={isSaving}
                    startContent={<Check className="h-4 w-4" aria-hidden="true" />}
                    onPress={() => onSave("confirmed")}
                  >
                    确认 AI 缺陷
                  </Button>
                  <Button
                    className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
                    isDisabled={!canEdit || isDeleted}
                    isLoading={isSaving}
                    startContent={<Save className="h-4 w-4" aria-hidden="true" />}
                    variant="flat"
                    onPress={() => onSave("modified")}
                  >
                    保存修改
                  </Button>
                </>
              )}
              <Button
                className="rounded-lg border border-red-200 bg-white font-bold text-red-600 shadow-none"
                isDisabled={!canEdit || isDeleted}
                isLoading={isDeleting}
                startContent={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                variant="flat"
                onPress={onDelete}
              >
                删除误检缺陷
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function NumberField({
  isDisabled,
  label,
  value,
  onChange
}: {
  isDisabled: boolean;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1 text-sm font-bold text-slate-700">
      {label}
      <input
        className="h-10 min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-ink outline-none focus:border-action"
        disabled={isDisabled}
        min={0}
        step={1}
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
      />
    </label>
  );
}

function MetricBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-black uppercase text-slate-500">{label}</p>
      <strong className="mt-2 block truncate text-base font-black text-ink">{value}</strong>
    </div>
  );
}
