import { Button, Card, CardBody, Skeleton } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Download,
  FileImage,
  Minus,
  Plus,
  RotateCcw,
  ZoomIn
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { Link as RouterLink, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import { downloadReportDocx, downloadTrialReportPdf, reportQueryOptions } from "@/api/reports";
import { completeDetectionReview, reviewDetectionPreviewQueryOptions } from "@/api/review";
import { ReportDefectBox } from "@/components/ReportDefectBox";
import { WorkspaceTitleBar } from "@/components/WorkspaceTitleBar";
import type {
  ReportDefectSnapshot,
  ReportDetail
} from "@/types/reports";
import { useAuthStore } from "@/stores/useAuthStore";
import { formatDateTime } from "@/utils/projectDisplay";
import { saveBlobAsFile } from "@/utils/download";
import { pairVisibleThermalPhotos, photoVariantFromFilename } from "@/utils/photoPairing";
import { formatDefectNumber, trialDefectDescriptionFromType } from "@/utils/trialDefectDisplay";

function confirmReportExport() {
  return window.confirm("请妥善保管导出文件。确认继续导出？");
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function ReportDetailPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const requestedReviewTaskId = new URLSearchParams(location.search).get("reviewTaskId") ?? "";
  const reviewTaskId = user?.role === "reviewer" || user?.role === "admin"
    ? requestedReviewTaskId
    : "";
  const isReviewPreview = Boolean(reviewTaskId);
  const reportQuery = useQuery({
    ...reportQueryOptions(id, false, user),
    enabled: Boolean(id && !isReviewPreview)
  });
  const reviewPreviewQuery = useQuery({
    ...reviewDetectionPreviewQueryOptions(reviewTaskId),
    enabled: isReviewPreview
  });
  const activeQuery = isReviewPreview ? reviewPreviewQuery : reportQuery;
  const report = activeQuery.data;

  if (activeQuery.isLoading) {
    return (
      <div className="grid gap-5">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-80 rounded-lg" />
      </div>
    );
  }

  if (activeQuery.isError || !report) {
    return (
      <div className="grid min-h-[calc(100svh-8rem)] place-items-center">
        <Card className="w-full max-w-2xl rounded-lg border border-red-200 shadow-none">
          <CardBody className="gap-4 p-6">
            <h1 className="text-xl font-black text-ink">结果加载失败</h1>
            <p className="text-sm font-bold text-red-700">
              {getErrorMessage(activeQuery.error)}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                className="w-fit rounded-lg bg-primary font-bold text-white shadow-none"
                onPress={() => void activeQuery.refetch()}
              >
                重新加载
              </Button>
              {isReviewPreview ? (
                <Button
                  as={RouterLink}
                  className="report-back-button w-fit rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
                  to={`/review/detections/${reviewTaskId}`}
                  variant="flat"
                >
                  返回修改
                </Button>
              ) : null}
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  const canonicalPath = report.source_type === "trial"
    ? `/trials/${report.id}`
    : `/detections/results/${report.id}`;
  if (location.pathname !== canonicalPath) {
    return <Navigate replace to={canonicalPath} />;
  }

  return (
    <TrialResultDetail
      report={report}
      canExport={Boolean(user)}
      reviewTaskId={reviewTaskId || undefined}
    />
  );
}

function TrialResultDetail({
  report,
  canExport,
  reviewTaskId
}: {
  report: ReportDetail;
  canExport: boolean;
  reviewTaskId?: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [annotatedPreview, setAnnotatedPreview] = useState<TrialReportAnnotatedPreview | null>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const formalTableHeaderRef = useRef<HTMLDivElement | null>(null);
  const previewDrag = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const previewDragMoved = useRef(false);
  const isTrialResult = report.source_type === "trial";
  const exportFormat = isTrialResult ? "PDF" : "DOCX";
  const exportMutation = useMutation({
    mutationFn: () => isTrialResult
      ? downloadTrialReportPdf(report.id)
      : downloadReportDocx(report.id),
    onSuccess: (blob) => {
      const extension = isTrialResult ? "pdf" : "docx";
      saveBlobAsFile(blob, `${report.report_no}-${report.title}.${extension}`);
    }
  });
  const completeReviewMutation = useMutation({
    mutationFn: () => completeDetectionReview(reviewTaskId ?? ""),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["review"] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] })
      ]);
      navigate("/review", { replace: true });
    }
  });
  const resultRows = useMemo(() => buildTrialResultRows(report), [report]);
  const formalResultRows = useMemo(
    () => isTrialResult ? [] : buildFormalResultRows(resultRows),
    [isTrialResult, resultRows]
  );
  function clampPreviewOffset(offset: { x: number; y: number }, scale: number) {
    const viewport = previewViewportRef.current;
    if (!viewport || scale <= 1) return { x: 0, y: 0 };
    const maxX = (viewport.clientWidth * (scale - 1)) / 2;
    const maxY = (viewport.clientHeight * (scale - 1)) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, offset.x)),
      y: Math.max(-maxY, Math.min(maxY, offset.y))
    };
  }

  function updatePreviewScale(nextScale: number) {
    const scale = Math.min(4, Math.max(1, nextScale));
    setPreviewScale(scale);
    setPreviewOffset((current) => clampPreviewOffset(current, scale));
  }

  function resetPreviewView() {
    setPreviewScale(1);
    setPreviewOffset({ x: 0, y: 0 });
  }

  function closeAnnotatedPreview() {
    setAnnotatedPreview(null);
    resetPreviewView();
  }

  function handleAnnotatedPreviewBackdropClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (previewDragMoved.current) return;
    const target = event.target;
    if (
      target instanceof Element
      && target.closest(".trial-photo-preview-toolbar, .trial-photo-preview-annotated, figcaption")
    ) return;
    closeAnnotatedPreview();
  }

  return (
    <div className={`trial-result-detail-page formal-result-detail-page${isTrialResult ? " quick-result-detail-page" : ""}`}>
      <WorkspaceTitleBar
        backLabel={reviewTaskId ? "返回修改" : isTrialResult ? "返回快速体验" : "返回专业检测"}
        backTo={reviewTaskId ? `/review/detections/${reviewTaskId}` : isTrialResult ? "/trials" : "/detections"}
        className="trial-result-toolbar result-title-bar"
        meta={<time dateTime={report.generated_at}>{formatDateTime(report.generated_at)}</time>}
        title={report.project.name || report.title || report.project.project_no || report.report_no}
        actions={reviewTaskId ? (
            <button
              aria-busy={completeReviewMutation.isPending}
              className="button primary review-preview-complete-button"
              disabled={completeReviewMutation.isPending}
              type="button"
              onClick={() => {
                if (window.confirm("确认当前预览结果无误并完成审核？完成后将推送正式结果并返回审核工作台。")) {
                  completeReviewMutation.mutate();
                }
              }}
            >
              <CheckCircle2 aria-hidden="true" />
              <span className="workspace-title-bar-action-label">
                {completeReviewMutation.isPending ? "正在完成审核…" : "完成审核"}
              </span>
            </button>
          ) : canExport ? (
            <button
              aria-busy={exportMutation.isPending}
              className="button secondary report-back-button report-export-button"
              disabled={exportMutation.isPending}
              type="button"
              onClick={() => {
                if (confirmReportExport()) exportMutation.mutate();
              }}
            >
              <Download aria-hidden="true" />
              <span className="workspace-title-bar-action-label">
                {exportMutation.isPending ? "正在导出" : `导出 ${exportFormat}`}
              </span>
            </button>
          ) : undefined}
      />
      {exportMutation.isError ? (
        <p className="project-list-error">{exportFormat} 导出失败：{getErrorMessage(exportMutation.error)}<button className="inline-retry-button" type="button" onClick={() => exportMutation.mutate()}>重试</button></p>
      ) : null}
      {completeReviewMutation.isError ? (
        <p className="project-list-error">完成审核失败：{getErrorMessage(completeReviewMutation.error)}<button className="inline-retry-button" type="button" onClick={() => completeReviewMutation.mutate()}>重试</button></p>
      ) : null}
      <div className="trial-experience-shell trial-experience-content-shell trial-result-detail-shell">
        <section className="trial-experience-grid">
          <aside className="trial-report-panel">
            <div className="trial-report-result is-headless">
              {resultRows.length ? (
                <div className={`trial-report-table-wrap${isTrialResult ? " formal-report-table-body-wrap" : " formal-report-table-layout"}`}>
                  {isTrialResult ? (
                    <table className="trial-report-table trial-report-table--without-tile">
                      <colgroup>
                        <col className="trial-sequence-col" />
                        <col className="trial-photo-col" />
                        <col className="trial-description-col" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th className="trial-sequence-column">序号</th>
                          <th className="trial-photo-column">含标注的照片</th>
                          <th className="trial-report-description">检测说明</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultRows.map((row, index) => (
                          <TrialResultRow
                            key={row.key}
                            row={row}
                            index={index}
                            onPreview={(preview) => {
                              resetPreviewView();
                              setAnnotatedPreview(preview);
                            }}
                          />
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <>
                      <div ref={formalTableHeaderRef} className="formal-report-table-header-wrap">
                        <table
                          aria-label="检测结果表头"
                          className="trial-report-table trial-report-table--without-tile formal-report-table--with-metadata formal-report-table--paired-photos"
                        >
                          <FormalResultColumns />
                          <thead>
                            <tr>
                              <th className="trial-sequence-column">序号</th>
                              <th className="trial-photo-column formal-visible-photo-column">可见光图像</th>
                              <th className="trial-photo-column formal-thermal-photo-column">热红外图像</th>
                              <th className="trial-report-description">检测说明</th>
                              <th className="formal-report-area-column">缺陷面积（m²）</th>
                              <th className="formal-report-metadata-column">立面朝向<br />拍摄高度（m）</th>
                            </tr>
                          </thead>
                        </table>
                      </div>
                      <div
                        className="formal-report-table-body-wrap"
                        onScroll={(event) => {
                          if (formalTableHeaderRef.current) {
                            formalTableHeaderRef.current.scrollLeft = event.currentTarget.scrollLeft;
                          }
                        }}
                      >
                        <table
                          aria-label="检测结果列表"
                          className="trial-report-table trial-report-table--without-tile formal-report-table--with-metadata formal-report-table--paired-photos"
                        >
                          <FormalResultColumns />
                          <tbody>
                            {formalResultRows.map((row, index) => (
                              <FormalResultRow
                                key={row.key}
                                row={row}
                                index={index}
                                onPreview={(preview) => {
                                  resetPreviewView();
                                  setAnnotatedPreview(preview);
                                }}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="trial-report-empty">
                  <CheckCircle2 aria-hidden="true" />
                  <h2>暂无识别结果</h2>
                  <p>当前记录中没有可展示的检测照片。</p>
                </div>
              )}
            </div>
          </aside>
        </section>
      </div>
      {annotatedPreview ? (
        <div
          className="trial-photo-preview-modal"
          role="dialog"
          aria-modal="true"
          aria-label="含标注的照片预览"
          onClick={handleAnnotatedPreviewBackdropClick}
        >
          <figure>
            <div className="trial-photo-preview-toolbar" aria-label="照片缩放控制">
              <button type="button" aria-label="缩小照片" title="缩小" disabled={previewScale <= 1} onClick={() => updatePreviewScale(previewScale - 0.25)}>
                <Minus aria-hidden="true" />
              </button>
              <output aria-label="当前缩放比例">{Math.round(previewScale * 100)}%</output>
              <button type="button" aria-label="放大照片" title="放大" disabled={previewScale >= 4} onClick={() => updatePreviewScale(previewScale + 0.25)}>
                <Plus aria-hidden="true" />
              </button>
              <button type="button" aria-label="恢复照片原始大小" title="恢复原始大小" onClick={resetPreviewView}>
                <RotateCcw aria-hidden="true" />
              </button>
            </div>
            <div
              ref={previewViewportRef}
              className={`trial-photo-preview-viewport ${previewScale > 1 ? "is-draggable" : ""}`}
              onWheel={(event) => {
                event.preventDefault();
                updatePreviewScale(previewScale + (event.deltaY < 0 ? 0.25 : -0.25));
              }}
              onPointerDown={(event) => {
                if (previewScale <= 1 || (event.pointerType === "mouse" && event.button !== 0)) return;
                event.preventDefault();
                previewDragMoved.current = false;
                event.currentTarget.setPointerCapture(event.pointerId);
                previewDrag.current = {
                  pointerId: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                  originX: previewOffset.x,
                  originY: previewOffset.y
                };
              }}
              onPointerMove={(event) => {
                if (!previewDrag.current || previewDrag.current.pointerId !== event.pointerId) return;
                if (
                  Math.abs(event.clientX - previewDrag.current.x)
                  + Math.abs(event.clientY - previewDrag.current.y) >= 3
                ) previewDragMoved.current = true;
                setPreviewOffset(clampPreviewOffset({
                  x: previewDrag.current.originX + event.clientX - previewDrag.current.x,
                  y: previewDrag.current.originY + event.clientY - previewDrag.current.y
                }, previewScale));
              }}
              onPointerUp={(event) => {
                if (previewDrag.current?.pointerId !== event.pointerId) return;
                previewDrag.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                window.setTimeout(() => { previewDragMoved.current = false; }, 0);
              }}
              onPointerCancel={() => {
                previewDrag.current = null;
                window.setTimeout(() => { previewDragMoved.current = false; }, 0);
              }}
              onLostPointerCapture={() => { previewDrag.current = null; }}
            >
              <div
                className="trial-annotated-photo trial-photo-preview-annotated"
                style={{ transform: `translate3d(${previewOffset.x}px, ${previewOffset.y}px, 0) scale(${previewScale})` }}
              >
                <img draggable={false} alt={`${annotatedPreview.filename} 检测标注预览`} src={annotatedPreview.imageUrl} />
                {annotatedPreview.defects.map((defect, defectIndex) => (
                  <ReportDefectBox
                    key={defect.id || `${defect.defect_type}-${defectIndex}`}
                    defect={defect}
                    imageHeight={annotatedPreview.imageHeight}
                    imageWidth={annotatedPreview.imageWidth}
                    fallbackIndex={defectIndex}
                  />
                ))}
              </div>
            </div>
            <figcaption>{annotatedPreview.filename}</figcaption>
          </figure>
        </div>
      ) : null}
    </div>
  );
}

interface TrialReportAnnotatedPreview {
  filename: string;
  imageUrl: string;
  imageWidth?: number | string | null;
  imageHeight?: number | string | null;
  defects: ReportDefectSnapshot[];
}

interface TrialResultPhotoRow {
  key: string;
  filename: string;
  imageUrl: string;
  imageWidth?: number | string | null;
  imageHeight?: number | string | null;
  relativeAltitude?: number | string | null;
  facadeOrientation?: string | null;
  isThermal: boolean;
  defects: ReportDefectSnapshot[];
}

interface FormalResultPhotoPair {
  key: string;
  visiblePhoto: TrialResultPhotoRow | null;
  thermalPhoto: TrialResultPhotoRow | null;
}

function FormalResultColumns() {
  return (
    <colgroup>
      <col className="trial-sequence-col" />
      <col className="formal-visible-photo-col" />
      <col className="formal-thermal-photo-col" />
      <col className="trial-description-col" />
      <col className="formal-report-area-col" />
      <col className="formal-report-metadata-col" />
    </colgroup>
  );
}

function TrialResultRow({
  row,
  index,
  onPreview
}: {
  row: TrialResultPhotoRow;
  index: number;
  onPreview: (preview: TrialReportAnnotatedPreview) => void;
}) {
  const summary = trialResultDefectSummary(row.defects);

  return (
    <tr>
      <td className="trial-sequence-column">
        <span className="trial-report-index">
          {String(index + 1).padStart(2, "0")}
        </span>
      </td>
      <ResultPhotoCell row={row} onPreview={onPreview} />
      <ResultDescriptionCell summary={summary} />
    </tr>
  );
}

function FormalResultRow({
  row,
  index,
  onPreview
}: {
  row: FormalResultPhotoPair;
  index: number;
  onPreview: (preview: TrialReportAnnotatedPreview) => void;
}) {
  const primaryPhoto = row.visiblePhoto ?? row.thermalPhoto;
  const defects = [
    ...(row.visiblePhoto?.defects ?? []),
    ...(row.thermalPhoto?.defects ?? [])
  ];
  const summary = trialResultDefectSummary(defects);

  return (
    <tr>
      <td className="trial-sequence-column">
        <span className="trial-report-index">
          {String(index + 1).padStart(2, "0")}
        </span>
      </td>
      <ResultPhotoCell row={row.visiblePhoto} onPreview={onPreview} />
      <ResultPhotoCell row={row.thermalPhoto} onPreview={onPreview} />
      <ResultDescriptionCell summary={summary} />
      <ResultAreaCell defects={defects} />
      <td className="formal-report-metadata-column">
        <strong>{primaryPhoto?.facadeOrientation || "未知立面"}</strong>
        <span>{formatRelativeAltitude(primaryPhoto?.relativeAltitude)}</span>
      </td>
    </tr>
  );
}

function ResultPhotoCell({
  row,
  onPreview
}: {
  row: TrialResultPhotoRow | null;
  onPreview: (preview: TrialReportAnnotatedPreview) => void;
}) {
  if (!row) {
    return (
      <td className="trial-photo-column formal-unmatched-photo-cell">
        <div className="formal-unmatched-photo">
          <FileImage aria-hidden="true" />
          <strong>无匹配图像</strong>
        </div>
      </td>
    );
  }

  const photo = row;
  const canPreview = Boolean(photo.imageUrl);
  function previewAnnotatedPhoto() {
    if (!photo.imageUrl) return;
    onPreview({
      filename: photo.filename,
      imageUrl: photo.imageUrl,
      imageWidth: photo.imageWidth,
      imageHeight: photo.imageHeight,
      defects: photo.defects
    });
  }

  return (
    <td className="trial-photo-column">
      <figure className="trial-annotated-photo-frame">
        <div
          className={`trial-annotated-photo ${photo.imageUrl ? "" : "trial-annotated-photo-placeholder"} ${canPreview ? "is-clickable" : ""}`}
          title={canPreview ? "点击放大查看" : undefined}
          onClick={previewAnnotatedPhoto}
        >
          {photo.imageUrl ? <img alt={`${photo.filename} 检测标注`} src={photo.imageUrl} /> : <FileImage aria-hidden="true" />}
          {photo.defects.map((defect, defectIndex) => (
            <ReportDefectBox
              key={defect.id || `${defect.defect_type}-${defectIndex}`}
              defect={defect}
              imageHeight={photo.imageHeight}
              imageWidth={photo.imageWidth}
              fallbackIndex={defectIndex}
            />
          ))}
          {canPreview ? (
            <div className="trial-annotated-photo-actions">
              <button
                type="button"
                aria-label={`放大查看${photo.filename}`}
                title="放大查看"
                onClick={(event) => {
                  event.stopPropagation();
                  previewAnnotatedPhoto();
                }}
              >
                <ZoomIn aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>
        <figcaption title={photo.filename}>{photo.filename}</figcaption>
      </figure>
    </td>
  );
}

function ResultDescriptionCell({
  summary
}: {
  summary: ReturnType<typeof trialResultDefectSummary>;
}) {
  return (
    <td className="trial-report-description">
      {summary.length ? (
        <p>
          {summary.map((item) => {
            const description = trialDefectDescriptionFromType(item.defectType, item.count);
            return (
              <span key={item.defectType} className={description.className}>
                {description.text}
              </span>
            );
          })}
        </p>
      ) : (
        <p><span>未检出明显缺陷</span></p>
      )}
    </td>
  );
}

function formatDefectAreaParts(defect: ReportDefectSnapshot) {
  if (defect.area === null || defect.area === undefined || defect.area === "") {
    return { available: false, value: "", estimated: false };
  }
  const area = Number(defect.area);
  if (!Number.isFinite(area) || area < 0) return { available: false, value: "", estimated: false };
  const digits = area >= 1 ? 2 : area >= 0.1 ? 3 : 4;
  return {
    available: true,
    value: area.toFixed(digits),
    estimated: Boolean(defect.area_estimated)
  };
}

const MAX_VISIBLE_AREA_ITEMS = 10;

function ResultAreaCell({ defects }: { defects: ReportDefectSnapshot[] }) {
  const formattedAreaItems = defects.map((defect, index) => {
    const defectNumber = defect.defect_no || formatDefectNumber(defect.defect_type, index + 1);
    const area = formatDefectAreaParts(defect);
    return {
      key: `${defect.id || defectNumber}-${index}`,
      defectNumber,
      available: area.available,
      areaValue: area.value,
      estimated: area.estimated,
      text: area.available
        ? `${defectNumber}${area.estimated ? " ≈" : ""} ${area.value}`
        : "参数不足"
    };
  });
  const missingAreaItem = formattedAreaItems.find((item) => !item.available);
  const areaItems = [
    ...formattedAreaItems.filter((item) => item.available),
    ...(missingAreaItem ? [missingAreaItem] : [])
  ];
  const areaSummary = areaItems.map((item) => item.text).join("、");
  const hasOverflow = areaItems.length > MAX_VISIBLE_AREA_ITEMS;
  const visibleAreaItems = areaItems.slice(0, MAX_VISIBLE_AREA_ITEMS);

  return (
    <td className="formal-report-area-column">
      {areaItems.length ? (
        <div className="formal-report-area-list" title={areaSummary} aria-label={areaSummary}>
          {visibleAreaItems.map((item) => (
            <div key={item.key} className="formal-report-area-item">
              {item.available ? (
                <>
                  <span className="formal-report-area-muted">
                    {item.defectNumber}{item.estimated ? " ≈" : ""}
                  </span>
                  <span className="formal-report-area-value"> {item.areaValue}</span>
                </>
              ) : "参数不足"}
            </div>
          ))}
          {hasOverflow ? <div className="formal-report-area-ellipsis" aria-hidden="true">......</div> : null}
        </div>
      ) : "—"}
    </td>
  );
}

function buildTrialResultRows(report: ReportDetail): TrialResultPhotoRow[] {
  const defectsByPhoto = new Map<string, ReportDefectSnapshot[]>();
  for (const defect of report.defects ?? []) {
    const photo = findTrialPhoto(report, defect);
    const key = photo ? trialPhotoGroupKey(photo) : trialDefectGroupKey(defect);
    if (!key) continue;
    const group = defectsByPhoto.get(key) ?? [];
    group.push(defect);
    defectsByPhoto.set(key, group);
  }

  const consumedKeys = new Set<string>();
  const rows = report.photos
    .map((photo, index) => {
      const key = trialPhotoGroupKey(photo) || `photo-index:${index}`;
      consumedKeys.add(key);
      const rowDefects = defectsByPhoto.get(key) ?? [];
      const modelOutput = findTrialModelOutput(report, photo.id, photo.original_filename);
      return {
        key,
        filename: photo.original_filename || "检测结果照片",
        imageUrl: trialResultRowImageUrl(rowDefects, photo),
        imageWidth: modelOutput?.image_width ?? photo.image_width,
        imageHeight: modelOutput?.image_height ?? photo.image_height,
        relativeAltitude: photo.relative_altitude,
        facadeOrientation: photo.facade_orientation,
        isThermal: isThermalReportPhoto(photo),
        defects: rowDefects
      };
    });

  for (const [key, rowDefects] of defectsByPhoto) {
    if (consumedKeys.has(key) || !rowDefects.length) continue;
    rows.push({
      key,
      filename: rowDefects[0]?.photo_filename || "检测结果照片",
      imageUrl: trialResultRowImageUrl(rowDefects),
      imageWidth: rowDefects[0]?.raw_result_json?.finding?.image_width,
      imageHeight: rowDefects[0]?.raw_result_json?.finding?.image_height,
      relativeAltitude: undefined,
      facadeOrientation: undefined,
      isThermal: photoVariantFromFilename(rowDefects[0]?.photo_filename) === "thermal",
      defects: rowDefects
    });
  }

  return rows;
}

function buildFormalResultRows(rows: TrialResultPhotoRow[]): FormalResultPhotoPair[] {
  return pairVisibleThermalPhotos(rows, {
    filename: (row) => row.filename,
    isThermal: (row) => row.isThermal,
    itemKey: (row) => row.key
  }).map((pair) => ({
    key: pair.key,
    visiblePhoto: pair.visible,
    thermalPhoto: pair.thermal
  }));
}

function isThermalReportPhoto(photo: ReportDetail["photos"][number]) {
  const namedVariant = photoVariantFromFilename(photo.original_filename);
  if (namedVariant) return namedVariant === "thermal";
  return photo.photo_type === "thermal"
    || photo.thermal_imaging_available === true
    || photo.metadata_json?.thermal_imaging_available === true;
}

function formatRelativeAltitude(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "--";
  const altitude = Number(value);
  return Number.isFinite(altitude) ? altitude.toFixed(1) : "--";
}

function findTrialModelOutput(report: ReportDetail, photoId?: string, filename?: string | null) {
  return report.raw_model_outputs.find((output) => photoId && output.photo_id === photoId)
    ?? report.raw_model_outputs.find((output) => filename && output.filename === filename);
}

function trialPhotoGroupKey(photo: ReportDetail["photos"][number]) {
  if (photo.id) return `photo:${photo.id}`;
  if (photo.original_filename) return `filename:${photo.original_filename}`;
  return "";
}

function trialDefectGroupKey(defect: ReportDefectSnapshot) {
  if (defect.photo_id) return `photo:${defect.photo_id}`;
  if (defect.photo_filename) return `filename:${defect.photo_filename}`;
  if (defect.id) return `defect:${defect.id}`;
  return "";
}

function trialResultRowImageUrl(
  defects: ReportDefectSnapshot[],
  photo?: ReportDetail["photos"][number]
) {
  const defectWithUrl = defects.find((defect) => defect.photo_preview_url || defect.photo_thumbnail_url);
  return defectWithUrl?.photo_preview_url
    || defectWithUrl?.photo_thumbnail_url
    || photo?.preview_url
    || photo?.thumbnail_url
    || "";
}

function trialResultDefectSummary(defects: ReportDefectSnapshot[]) {
  const counts = new Map<string, number>();
  defects.forEach((defect) => {
    const defectType = defect.defect_type || "";
    counts.set(defectType, (counts.get(defectType) ?? 0) + 1);
  });
  return Array.from(counts, ([defectType, count]) => ({ defectType, count }));
}

function findTrialPhoto(report: ReportDetail, defect: ReportDefectSnapshot) {
  return report.photos.find((photo) => photo.id && defect.photo_id === photo.id)
    ?? report.photos.find((photo) => photo.original_filename && photo.original_filename === defect.photo_filename);
}
