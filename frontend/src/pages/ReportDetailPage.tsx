import { Button, Card, CardBody, Skeleton } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileCheck2,
  FileImage,
  Minus,
  Plus,
  RotateCcw,
  Trash2,
  ZoomIn
} from "lucide-react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { Link as RouterLink, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import { deleteReport, downloadReportDocx, downloadTrialReportPdf, reportQueryOptions } from "@/api/reports";
import { completeDetectionReview, reviewDetectionPreviewQueryOptions } from "@/api/review";
import { TilePreviewDialog, type TilePreviewSource } from "@/components/TilePreviewDialog";
import type {
  ModelOutputPhoto,
  ReportDefectSnapshot,
  ReportDetail
} from "@/types/reports";
import { useAuthStore } from "@/stores/useAuthStore";
import { formatDateTime } from "@/utils/projectDisplay";
import { saveBlobAsFile } from "@/utils/download";
import { trialDefectBoxLabel, trialDefectDescriptionFromType, trialDefectDisplayFromType } from "@/utils/trialDefectDisplay";

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
  const canShowTile = user?.role === "admin";
  const requestedReviewTaskId = new URLSearchParams(location.search).get("reviewTaskId") ?? "";
  const reviewTaskId = user?.role === "reviewer" || user?.role === "admin"
    ? requestedReviewTaskId
    : "";
  const isReviewPreview = Boolean(reviewTaskId);
  const reportQuery = useQuery({
    ...reportQueryOptions(id, false, user),
    enabled: Boolean(id && user?.id && !isReviewPreview)
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
              <Button
                as={RouterLink}
                className="report-back-button w-fit rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
                to={isReviewPreview ? `/review/detections/${reviewTaskId}` : "/detections"}
                variant="flat"
              >
                {isReviewPreview ? "返回修改" : "返回列表"}
              </Button>
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
      canShowTile={canShowTile}
      reviewTaskId={reviewTaskId || undefined}
    />
  );
}

function TrialResultDetail({
  report,
  canShowTile,
  reviewTaskId
}: {
  report: ReportDetail;
  canShowTile: boolean;
  reviewTaskId?: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [annotatedPreview, setAnnotatedPreview] = useState<TrialReportAnnotatedPreview | null>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const previewDrag = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const previewDragMoved = useRef(false);
  const [tilePreview, setTilePreview] = useState<TilePreviewSource | null>(null);
  const isTrialResult = report.source_type === "trial";
  const resultListPath = isTrialResult ? "/trials" : "/detections";
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
  const deleteMutation = useMutation({
    mutationFn: () => deleteReport(report.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] })
      ]);
      navigate(resultListPath, { replace: true });
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
    <div className={`trial-result-detail-page ${isTrialResult ? "" : "formal-result-detail-page"}`}>
      <div className="trial-result-toolbar">
        <div className="trial-result-title-block">
          <div className="trial-result-name-row management-page-title">
            <FileCheck2 aria-hidden="true" className="management-page-title-icon" />
            <h1>{report.title || report.project.project_no || report.report_no}</h1>
            <time className="trial-result-generated-time" dateTime={report.generated_at}>
              生成时间：{formatDateTime(report.generated_at)}
            </time>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {reviewTaskId ? (
            <>
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
                {completeReviewMutation.isPending ? "正在完成审核…" : "完成审核"}
              </button>
              <RouterLink
                className="button secondary report-back-button"
                to={`/review/detections/${reviewTaskId}`}
              >
                <ArrowLeft aria-hidden="true" />返回修改
              </RouterLink>
            </>
          ) : (
            <>
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
                {exportMutation.isPending ? "正在导出" : `导出 ${exportFormat}`}
              </button>
              <button
                aria-busy={deleteMutation.isPending}
                className="button secondary report-back-button result-delete-button"
                disabled={deleteMutation.isPending || exportMutation.isPending}
                type="button"
                onClick={() => {
                  const confirmation = isTrialResult
                    ? `确认删除“${report.title}”免费试用结果？删除后无法在列表中查看。`
                    : `确认删除检测项目“${report.title}”及其检测结果和关联检测任务？删除后无法在列表中查看。`;
                  if (window.confirm(confirmation)) {
                    deleteMutation.mutate();
                  }
                }}
              >
                <Trash2 aria-hidden="true" />
                {deleteMutation.isPending ? "删除中…" : "删除"}
              </button>
              <RouterLink className="button secondary report-back-button" to={resultListPath}>
                <ArrowLeft aria-hidden="true" />返回列表
              </RouterLink>
            </>
          )}
        </div>
      </div>
      {exportMutation.isError ? (
        <p className="project-list-error">{exportFormat} 导出失败：{getErrorMessage(exportMutation.error)}<button className="inline-retry-button" type="button" onClick={() => exportMutation.mutate()}>重试</button></p>
      ) : null}
      {deleteMutation.isError ? (
        <p className="project-list-error">删除失败：{getErrorMessage(deleteMutation.error)}<button className="inline-retry-button" type="button" onClick={() => deleteMutation.mutate()}>重试</button></p>
      ) : null}
      {completeReviewMutation.isError ? (
        <p className="project-list-error">完成审核失败：{getErrorMessage(completeReviewMutation.error)}<button className="inline-retry-button" type="button" onClick={() => completeReviewMutation.mutate()}>重试</button></p>
      ) : null}
      <div className="trial-experience-shell trial-experience-content-shell trial-result-detail-shell">
        <section className="trial-experience-grid">
          <aside className="trial-report-panel">
            <div className="trial-report-result is-headless">
              {resultRows.length ? (
                <div className="trial-report-table-wrap">
                  <table
                    className={`trial-report-table ${canShowTile ? "trial-report-table--with-tile" : "trial-report-table--without-tile"}${isTrialResult ? "" : " formal-report-table--with-metadata formal-report-table--paired-photos"}`}
                  >
                    {isTrialResult ? (
                      <colgroup>
                        <col className="trial-sequence-col" />
                        <col className="trial-photo-col" />
                        <col className="trial-description-col" />
                        {canShowTile ? <col className="trial-tile-col" /> : null}
                      </colgroup>
                    ) : (
                      <colgroup>
                        <col className="trial-sequence-col" />
                        <col className="formal-visible-photo-col" />
                        <col className="formal-thermal-photo-col" />
                        <col className="trial-description-col" />
                        <col className="formal-report-metadata-col" />
                        {canShowTile ? <col className="trial-tile-col" /> : null}
                      </colgroup>
                    )}
                    <thead>
                      <tr>
                        <th className="trial-sequence-column">序号</th>
                        {isTrialResult ? (
                          <th className="trial-photo-column">含标注的照片</th>
                        ) : (
                          <>
                            <th className="trial-photo-column formal-visible-photo-column">可见光图像</th>
                            <th className="trial-photo-column formal-thermal-photo-column">热红外图像</th>
                          </>
                        )}
                        <th className="trial-report-description">检测说明</th>
                        {!isTrialResult ? <th className="formal-report-metadata-column">立面朝向<br />拍摄高度</th> : null}
                        {canShowTile ? <th className="trial-tile-column">tile</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {isTrialResult
                        ? resultRows.map((row, index) => (
                            <TrialResultRow
                              key={row.key}
                              row={row}
                              index={index}
                              canShowTile={canShowTile}
                              onPreview={(preview) => {
                                resetPreviewView();
                                setAnnotatedPreview(preview);
                              }}
                              onTilePreview={setTilePreview}
                            />
                          ))
                        : formalResultRows.map((row, index) => (
                            <FormalResultRow
                              key={row.key}
                              row={row}
                              index={index}
                              canShowTile={canShowTile}
                              onPreview={(preview) => {
                                resetPreviewView();
                                setAnnotatedPreview(preview);
                              }}
                              onTilePreview={setTilePreview}
                            />
                          ))}
                    </tbody>
                  </table>
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
                  <TrialReportDefectBox
                    key={defect.id || `${defect.defect_type}-${defectIndex}`}
                    defect={defect}
                    imageHeight={annotatedPreview.imageHeight}
                    imageWidth={annotatedPreview.imageWidth}
                  />
                ))}
              </div>
            </div>
            <figcaption>{annotatedPreview.filename}</figcaption>
          </figure>
        </div>
      ) : null}
      {canShowTile && tilePreview ? (
        <TilePreviewDialog source={tilePreview} onClose={() => setTilePreview(null)} />
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
  tileWidth?: number | string | null;
  tileHeight?: number | string | null;
  tileOverlapRatio?: number | string | null;
  relativeAltitude?: number | string | null;
  facadeOrientation?: string | null;
  isThermal: boolean;
  detections?: ModelOutputPhoto["detections"];
  defects: ReportDefectSnapshot[];
}

interface FormalResultPhotoPair {
  key: string;
  visiblePhoto: TrialResultPhotoRow | null;
  thermalPhoto: TrialResultPhotoRow | null;
}

function TrialResultRow({
  row,
  index,
  canShowTile,
  onPreview,
  onTilePreview
}: {
  row: TrialResultPhotoRow;
  index: number;
  canShowTile: boolean;
  onPreview: (preview: TrialReportAnnotatedPreview) => void;
  onTilePreview: (source: TilePreviewSource) => void;
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
      {canShowTile ? (
        <td className="trial-tile-column">
          <ResultTileButton row={row} onTilePreview={onTilePreview} />
        </td>
      ) : null}
    </tr>
  );
}

function FormalResultRow({
  row,
  index,
  canShowTile,
  onPreview,
  onTilePreview
}: {
  row: FormalResultPhotoPair;
  index: number;
  canShowTile: boolean;
  onPreview: (preview: TrialReportAnnotatedPreview) => void;
  onTilePreview: (source: TilePreviewSource) => void;
}) {
  const primaryPhoto = row.visiblePhoto ?? row.thermalPhoto;
  const summary = trialResultDefectSummary([
    ...(row.visiblePhoto?.defects ?? []),
    ...(row.thermalPhoto?.defects ?? [])
  ]);

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
      <td className="formal-report-metadata-column">
        <strong>{primaryPhoto?.facadeOrientation || "未知立面"}</strong>
        <span>{formatRelativeAltitude(primaryPhoto?.relativeAltitude)}</span>
      </td>
      {canShowTile ? (
        <td className="trial-tile-column formal-paired-tile-column">
          <div className="formal-paired-tile-actions">
            {row.visiblePhoto ? (
              <ResultTileButton label="可见光" row={row.visiblePhoto} onTilePreview={onTilePreview} />
            ) : null}
            {row.thermalPhoto ? (
              <ResultTileButton label="热红外" row={row.thermalPhoto} onTilePreview={onTilePreview} />
            ) : null}
          </div>
        </td>
      ) : null}
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
            <TrialReportDefectBox
              key={defect.id || `${defect.defect_type}-${defectIndex}`}
              defect={defect}
              imageHeight={photo.imageHeight}
              imageWidth={photo.imageWidth}
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

function ResultTileButton({
  row,
  label,
  onTilePreview
}: {
  row: TrialResultPhotoRow;
  label?: string;
  onTilePreview: (source: TilePreviewSource) => void;
}) {
  return (
    <button
      className="trial-tile-view-button"
      disabled={!row.imageUrl}
      type="button"
      onClick={() => onTilePreview({
        filename: row.filename,
        imageUrl: row.imageUrl,
        imageWidth: row.imageWidth,
        imageHeight: row.imageHeight,
        tileWidth: row.tileWidth,
        tileHeight: row.tileHeight,
        tileOverlapRatio: row.tileOverlapRatio,
        detections: row.detections
      })}
    >
      {label ? `${label} tile` : "查看tile"}
    </button>
  );
}

function TrialReportDefectBox({
  defect,
  imageWidth,
  imageHeight
}: {
  defect: ReportDefectSnapshot;
  imageWidth?: number | string | null;
  imageHeight?: number | string | null;
}) {
  const defectDisplay = trialDefectDisplayFromType(defect.defect_type);
  const boxStyle = trialReportDefectBoxStyle(defect, imageWidth, imageHeight);
  if (!boxStyle) return null;

  return (
    <span
      className={`trial-defect-box ${defectDisplay.boxClassName}`}
      style={boxStyle}
    >
      <span className="trial-defect-label">
        {trialDefectBoxLabel(defectDisplay)}
      </span>
    </span>
  );
}

function trialReportDefectBoxStyle(
  defect: ReportDefectSnapshot,
  fallbackImageWidth?: number | string | null,
  fallbackImageHeight?: number | string | null
): CSSProperties | undefined {
  const bbox = defect.bbox_json;
  const x = finiteNumber(bbox?.x);
  const y = finiteNumber(bbox?.y);
  const width = finiteNumber(bbox?.width);
  const height = finiteNumber(bbox?.height);
  const imageWidth = finiteNumber(defect.raw_result_json?.finding?.image_width)
    ?? finiteNumber(fallbackImageWidth);
  const imageHeight = finiteNumber(defect.raw_result_json?.finding?.image_height)
    ?? finiteNumber(fallbackImageHeight);

  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
    return undefined;
  }

  if (imageWidth && imageHeight) {
    return {
      left: `${(x / imageWidth) * 100}%`,
      top: `${(y / imageHeight) * 100}%`,
      width: `${(width / imageWidth) * 100}%`,
      height: `${(height / imageHeight) * 100}%`,
      right: "auto",
      bottom: "auto"
    };
  }

  if (x <= 1 && y <= 1 && width <= 1 && height <= 1) {
    return {
      left: `${x * 100}%`,
      top: `${y * 100}%`,
      width: `${width * 100}%`,
      height: `${height * 100}%`,
      right: "auto",
      bottom: "auto"
    };
  }

  return undefined;
}

function finiteNumber(value: number | string | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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
        tileWidth: modelOutput?.tile_width,
        tileHeight: modelOutput?.tile_height,
        tileOverlapRatio: modelOutput?.tile_overlap_ratio,
        relativeAltitude: photo.relative_altitude,
        facadeOrientation: photo.facade_orientation,
        isThermal: isThermalReportPhoto(photo),
        detections: modelOutput?.detections,
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
      tileWidth: undefined,
      tileHeight: undefined,
      tileOverlapRatio: undefined,
      relativeAltitude: undefined,
      facadeOrientation: undefined,
      isThermal: photoVariantFromFilename(rowDefects[0]?.photo_filename) === "thermal",
      detections: undefined,
      defects: rowDefects
    });
  }

  return rows;
}

function buildFormalResultRows(rows: TrialResultPhotoRow[]): FormalResultPhotoPair[] {
  const consumedIndexes = new Set<number>();
  const pairs: FormalResultPhotoPair[] = [];

  rows.forEach((row, index) => {
    if (consumedIndexes.has(index)) return;
    consumedIndexes.add(index);

    const namedVariant = photoVariantFromFilename(row.filename);
    const pairKey = formalPhotoPairKey(row.filename);
    let matchedIndex = -1;
    if (namedVariant && pairKey) {
      matchedIndex = rows.findIndex((candidate, candidateIndex) => (
        candidateIndex !== index
        && !consumedIndexes.has(candidateIndex)
        && formalPhotoPairKey(candidate.filename) === pairKey
        && photoVariantFromFilename(candidate.filename) !== namedVariant
      ));
    }

    const matchedRow = matchedIndex >= 0 ? rows[matchedIndex] : null;
    if (matchedIndex >= 0) consumedIndexes.add(matchedIndex);
    const rowVariant = namedVariant ?? (row.isThermal ? "thermal" : "visible");

    pairs.push({
      key: matchedRow ? `pair:${pairKey}:${row.key}` : `unmatched:${row.key}`,
      visiblePhoto: rowVariant === "visible" ? row : matchedRow,
      thermalPhoto: rowVariant === "thermal" ? row : matchedRow
    });
  });

  return pairs;
}

function formalPhotoPairKey(filename: string | null | undefined) {
  const match = filename?.trim().match(/^(.*)_([vt])(?:\.[^.]+)$/i);
  return match ? match[1].toLocaleLowerCase() : null;
}

function photoVariantFromFilename(filename: string | null | undefined): "visible" | "thermal" | null {
  const match = filename?.trim().match(/_([vt])(?:\.[^.]+)$/i);
  if (!match) return null;
  return match[1].toLocaleLowerCase() === "t" ? "thermal" : "visible";
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
  return Number.isFinite(altitude) ? `${altitude.toFixed(1)} m` : "--";
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
