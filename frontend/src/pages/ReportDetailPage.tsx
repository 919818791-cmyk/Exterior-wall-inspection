import {
  Button,
  Card,
  CardBody,
  Skeleton
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Download,
  FileImage,
  Minus,
  Plus,
  RotateCcw,
  Trash2,
  ZoomIn
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { Link as RouterLink, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import { deleteReport, downloadReportDocx, downloadTrialReportPdf, reportQueryOptions } from "@/api/reports";
import {
  completeDetectionReview,
  reviewDetectionPreviewQueryOptions
} from "@/api/review";
import { ReportDefectBox } from "@/components/ReportDefectBox";
import { WorkspaceTitleBar } from "@/components/WorkspaceTitleBar";
import type {
  ReportBuildingModelImage,
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
            <p className="text-sm font-normal text-red-700">
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
                  className="back-cancel-button w-fit"
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
  const deleteReportMutation = useMutation({
    mutationFn: () => deleteReport(report.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] })
      ]);
      navigate("/trials", { replace: true });
    }
  });
  const resultRows = useMemo(() => buildTrialResultRows(report), [report]);
  const formalResultRows = useMemo(
    () => isTrialResult ? [] : buildFormalResultRows(resultRows),
    [isTrialResult, resultRows]
  );
  const isBuildingModelReport = !isTrialResult && buildingModelReportRequested(report);
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

  function requestCompleteReview() {
    if (window.confirm("确认当前预览结果无误并完成审核？完成后将推送正式结果并返回工作台。")) {
      completeReviewMutation.mutate();
    }
  }

  return (
    <div className={`trial-result-detail-page formal-result-detail-page${isTrialResult ? " quick-result-detail-page" : ""}${isBuildingModelReport ? " building-model-report-detail-page" : ""}`}>
      <WorkspaceTitleBar
        backLabel={reviewTaskId ? "返回修改" : isTrialResult ? "返回快速体验" : "返回专业检测"}
        backTo={reviewTaskId ? `/review/detections/${reviewTaskId}` : isTrialResult ? "/trials" : "/detections"}
        className="trial-result-toolbar result-title-bar"
        meta={<time dateTime={report.generated_at}>{formatDateTime(report.generated_at)}</time>}
        title={report.project.name || report.title || report.project.project_no || report.report_no}
        actions={reviewTaskId ? (
            <button
              aria-busy={completeReviewMutation.isPending}
              className="button primary-action-button review-preview-complete-button"
              disabled={completeReviewMutation.isPending}
              type="button"
              onClick={requestCompleteReview}
            >
              <CheckCircle2 aria-hidden="true" />
              <span className="workspace-title-bar-action-label">
                {completeReviewMutation.isPending ? "正在完成审核…" : "完成审核"}
              </span>
            </button>
          ) : (
            <>
              {canExport ? (
                <button
                  aria-busy={exportMutation.isPending}
                  className="button primary-action-button report-export-button"
                  disabled={exportMutation.isPending || deleteReportMutation.isPending}
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
              ) : null}
              {isTrialResult ? (
                <button
                  aria-busy={deleteReportMutation.isPending}
                  className="button destructive-action-button report-delete-button"
                  disabled={report.is_example || exportMutation.isPending || deleteReportMutation.isPending}
                  title={report.is_example ? "示例项目为所有账号共享，无法删除" : `删除：${report.title}`}
                  type="button"
                  onClick={() => {
                    if (window.confirm(`确认删除试用结果“${report.title}”？删除后将无法恢复。`)) {
                      deleteReportMutation.mutate();
                    }
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  <span className="workspace-title-bar-action-label">
                    {deleteReportMutation.isPending ? "正在删除" : "删除"}
                  </span>
                </button>
              ) : null}
            </>
          )}
      />
      {exportMutation.isError ? (
        <p className="project-list-error">{exportFormat} 导出失败：{getErrorMessage(exportMutation.error)}<button className="inline-retry-button" type="button" onClick={() => exportMutation.mutate()}>重试</button></p>
      ) : null}
      {completeReviewMutation.isError ? (
        <p className="project-list-error">完成审核失败：{getErrorMessage(completeReviewMutation.error)}<button className="inline-retry-button" type="button" onClick={() => completeReviewMutation.mutate()}>重试</button></p>
      ) : null}
      {deleteReportMutation.isError ? (
        <p className="project-list-error">删除失败：{getErrorMessage(deleteReportMutation.error)}<button className="inline-retry-button" type="button" onClick={() => deleteReportMutation.mutate()}>重试</button></p>
      ) : null}
      <div className="trial-experience-shell trial-experience-content-shell trial-result-detail-shell">
        <section className="trial-experience-grid">
          <aside className="trial-report-panel">
            <div className="trial-report-result is-headless">
              {isBuildingModelReport ? (
                <BuildingModelReportView
                  report={report}
                  rows={formalResultRows}
                  onPreview={(preview) => {
                    resetPreviewView();
                    setAnnotatedPreview(preview);
                  }}
                />
              ) : resultRows.length ? (
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
                              <th className="formal-report-detail-column">缺陷详情</th>
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

const BUILDING_MODEL_REPORT_ORIENTATIONS = [
  { id: "east", label: "东立面" },
  { id: "south", label: "南立面" },
  { id: "west", label: "西立面" },
  { id: "north", label: "北立面" }
] as const;

function buildingModelReportRequested(report: ReportDetail) {
  const config = report.detection_config;
  if (!config) return false;
  const configJson = config.config_json;
  if (!configJson || typeof configJson !== "object") return false;
  if (configJson.generate_building_model === true) return true;
  const nestedConfig = configJson.config_json;
  return Boolean(
    nestedConfig
    && typeof nestedConfig === "object"
    && "generate_building_model" in nestedConfig
    && (nestedConfig as Record<string, unknown>).generate_building_model === true
  );
}

function BuildingModelReportView({
  report,
  rows,
  onPreview
}: {
  report: ReportDetail;
  rows: FormalResultPhotoPair[];
  onPreview: (preview: TrialReportAnnotatedPreview) => void;
}) {
  const imagesBySlot = new Map(
    (report.building_model_images ?? []).map((image) => [
      `${image.orientation}:${image.image_kind}`,
      image
    ])
  );
  const projectName = report.project.name || report.title || report.report_no;

  return (
    <article className="building-model-report-document">
      <h1>{projectName}无人机外立面表观病害筛查分析报告</h1>

      <section className="building-model-report-section">
        <h2>一、工程概况</h2>
        <p className="building-model-report-intro">
          针对{projectName}外立面开展无人机双光数据采集与智能分析，通过可见光与热红外影像同步获取，结合三维重建技术生成高精度建筑三维模型及外立面正射影像，通过智能算法自动识别裂缝、空鼓、剥落等表观病害，并经人工复核确认；并将识别结果映射至各外立面上，完成几何量化与定位，为建筑外立面安全评估与维修决策提供数据支撑。
        </p>
        <BuildingModelReportFigure
          caption="建筑三维模型"
          image={imagesBySlot.get("overview:model")}
        />
        <div className="building-model-report-elevation-list" aria-label="建筑三维模型四个立面">
          {BUILDING_MODEL_REPORT_ORIENTATIONS.map((orientation) => (
            <BuildingModelReportFigure
              key={orientation.id}
              caption={orientation.label}
              image={imagesBySlot.get(`${orientation.id}:elevation`)}
            />
          ))}
        </div>
      </section>

      <section className="building-model-report-section building-model-report-analysis">
        <h2>二、分析结果</h2>
        {BUILDING_MODEL_REPORT_ORIENTATIONS.map((orientation, orientationIndex) => {
          const orientationRows = rows.filter((row) => (
            buildingModelRowOrientation(row) === orientation.id
          ));
          return (
            <section key={orientation.id} className="building-model-report-orientation-section">
              <BuildingModelReportFigure
                caption={`图 ${orientationIndex + 1} ${orientation.label}表观损伤分布`}
                image={imagesBySlot.get(`${orientation.id}:annotated`)}
              />
              <table
                aria-label={`${orientation.label}检测结果`}
                className="building-model-report-table"
              >
                <BuildingModelResultColumns />
                <thead>
                  <tr>
                    <th>序号</th>
                    <th>可见光图像</th>
                    <th>热红外图像</th>
                    <th>损伤</th>
                    <th>坐标与<br />几何信息</th>
                  </tr>
                </thead>
                <tbody>
                  {orientationRows.length ? orientationRows.map((row, rowIndex) => (
                    <BuildingModelResultRow
                      key={row.key}
                      row={row}
                      index={rowIndex}
                      onPreview={onPreview}
                    />
                  )) : (
                    <tr className="building-model-report-empty-row">
                      <td>1</td>
                      <td>—</td>
                      <td>—</td>
                      <td>未检出明显缺陷</td>
                      <td>—</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          );
        })}
      </section>
    </article>
  );
}

function buildingModelRowOrientation(
  row: FormalResultPhotoPair
): (typeof BUILDING_MODEL_REPORT_ORIENTATIONS)[number]["id"] | null {
  const rawOrientation = row.visiblePhoto?.facadeOrientation
    || row.thermalPhoto?.facadeOrientation;
  const orientation = rawOrientation?.trim().toLocaleLowerCase();
  if (!orientation) return null;
  if (orientation === "东" || orientation === "东立面" || orientation === "east") return "east";
  if (orientation === "南" || orientation === "南立面" || orientation === "south") return "south";
  if (orientation === "西" || orientation === "西立面" || orientation === "west") return "west";
  if (orientation === "北" || orientation === "北立面" || orientation === "north") return "north";
  return null;
}

function BuildingModelReportFigure({
  image,
  caption
}: {
  image?: ReportBuildingModelImage;
  caption: string;
}) {
  return (
    <figure className="building-model-report-figure">
      {image?.url ? (
        <img alt={caption} src={image.url} />
      ) : (
        <div className="building-model-report-image-placeholder">
          <FileImage aria-hidden="true" />
          <span>图片尚未上传</span>
        </div>
      )}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function BuildingModelResultColumns() {
  return (
    <colgroup>
      <col className="building-model-report-sequence-col" />
      <col className="building-model-report-photo-col" />
      <col className="building-model-report-photo-col" />
      <col className="building-model-report-description-col" />
      <col className="building-model-report-detail-col" />
    </colgroup>
  );
}

function BuildingModelResultRow({
  row,
  index,
  onPreview
}: {
  row: FormalResultPhotoPair;
  index: number;
  onPreview: (preview: TrialReportAnnotatedPreview) => void;
}) {
  const defects = [
    ...(row.visiblePhoto?.defects ?? []),
    ...(row.thermalPhoto?.defects ?? [])
  ];

  return (
    <tr>
      <td className="trial-sequence-column">{index + 1}</td>
      <ResultPhotoCell row={row.visiblePhoto} onPreview={onPreview} />
      <ResultPhotoCell row={row.thermalPhoto} onPreview={onPreview} />
      <ResultDescriptionCell summary={trialResultDefectSummary(defects)} />
      <ResultDetailCell defects={defects} />
    </tr>
  );
}

function FormalResultColumns() {
  return (
    <colgroup>
      <col className="trial-sequence-col" />
      <col className="formal-visible-photo-col" />
      <col className="formal-thermal-photo-col" />
      <col className="trial-description-col" />
      <col className="formal-report-detail-col" />
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
      <ResultDetailCell defects={defects} />
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

function formatDefectMeasurement(defect: ReportDefectSnapshot) {
  const isCrack = defect.defect_type === "crack";
  const rawValue = isCrack ? defect.length : defect.area;
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return { available: false, value: "", estimated: false, unit: isCrack ? "m" : "m²" };
  }
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    return { available: false, value: "", estimated: false, unit: isCrack ? "m" : "m²" };
  }
  return {
    available: true,
    value: value.toFixed(3),
    estimated: Boolean(isCrack ? defect.length_estimated : defect.area_estimated),
    unit: isCrack ? "m" : "m²"
  };
}

function formatDefectCoordinate(defect: ReportDefectSnapshot) {
  const bbox = defect.bbox_json;
  const values = [bbox?.x, bbox?.y].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return "坐标不足";
  const [x, y] = values;
  const normalized = values.every((value) => value >= 0 && value <= 1);
  const coordinateValue = (value: number) => (
    Number.isInteger(value)
      ? String(value)
      : value.toFixed(normalized ? 3 : 1).replace(/\.?0+$/, "")
  );
  return `x=${coordinateValue(x)}，y=${coordinateValue(y)}`;
}

function ResultDetailCell({ defects }: { defects: ReportDefectSnapshot[] }) {
  const formattedDetailItems = defects.map((defect, index) => {
    const defectNumber = defect.defect_no || formatDefectNumber(defect.defect_type, index + 1);
    const measurement = formatDefectMeasurement(defect);
    const coordinate = formatDefectCoordinate(defect);
    const measurementText = measurement.available
      ? `${measurement.estimated ? "≈" : " "}${measurement.value} ${measurement.unit}`
      : "几何参数不足";
    const text = `${defectNumber}${measurementText}（${coordinate}）`;
    return {
      key: `${defect.id || defectNumber}-${index}`,
      text
    };
  });
  const detailSummary = formattedDetailItems.map((item) => item.text).join("、");

  return (
    <td className="formal-report-detail-column">
      {formattedDetailItems.length ? (
        <div className="formal-report-detail-list" title={detailSummary} aria-label={detailSummary}>
          {formattedDetailItems.map((item) => (
            <div key={item.key} className="formal-report-detail-item">
              {item.text}
            </div>
          ))}
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
