import { Button, Card, CardBody, Divider, Skeleton } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileCheck2,
  FileImage,
  FileText,
  Minus,
  Plus,
  RotateCcw,
  Send,
  ZoomIn
} from "lucide-react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import { Link as RouterLink, useParams, useSearchParams } from "react-router-dom";

import { downloadReportDocx, downloadTrialReportPdf, pushReport, reportQueryOptions } from "@/api/reports";
import { ModelOutputDialog } from "@/components/ModelOutputDialog";
import { TilePreviewDialog, type TilePreviewSource } from "@/components/TilePreviewDialog";
import { StatusPill } from "@/components/StatusPill";
import type {
  ModelOutputPhoto,
  ReportDefectSnapshot,
  ReportDetail
} from "@/types/reports";
import { useAuthStore } from "@/stores/useAuthStore";
import { formatDateTime } from "@/utils/projectDisplay";
import { saveBlobAsFile } from "@/utils/download";
import {
  formatModelOutputs,
  formatTileTokenUsages,
  hasModelOutputs,
  hasTileTokenUsages
} from "@/utils/modelOutputs";
import { trialDefectBoxLabel, trialDefectDescriptionFromType, trialDefectDisplayFromType } from "@/utils/trialDefectDisplay";

const DEFECT_LABELS: Record<string, string> = {
  crack: "裂缝",
  missing: "剥落",
  spalling: "剥落",
  moisture: "潮湿",
  corrosion: "锈蚀",
  hollow: "空鼓"
};

const REVIEW_STATUS_LABELS: Record<string, string> = {
  generated: "自动生成",
  confirmed: "已确认",
  modified: "已修改",
  added: "人工新增",
  deleted: "已删除"
};

const REPORT_STATUS_LABELS = {
  draft: "草稿",
  generated: "待推送",
  pushed: "已推送",
  revoked: "已撤回"
};

const REPORT_STATUS_TONES = {
  draft: "warning",
  generated: "warning",
  pushed: "success",
  revoked: "danger"
} as const;

function confirmReportExport() {
  return window.confirm("请妥善保管导出文件。确认继续导出？");
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function ReportDetailPage() {
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const canManageReports = user?.role === "reviewer" || user?.role === "admin";
  const canShowTile = user?.role === "admin";
  const includeGenerated = canManageReports && searchParams.get("mode") === "review";
  const reportQuery = useQuery(reportQueryOptions(id, includeGenerated, user));
  const report = reportQuery.data;
  const [message, setMessage] = useState("");
  const [isModelOutputOpen, setIsModelOutputOpen] = useState(false);
  const isTrialResult = report?.source_type === "trial";

  const pushMutation = useMutation({
    mutationFn: () => pushReport(id),
    onSuccess: async () => {
      setMessage("报告已推送，项目已进入已完成状态。");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
        queryClient.invalidateQueries({ queryKey: ["review"] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] })
      ]);
    }
  });
  const downloadMutation = useMutation({
    mutationFn: () => downloadReportDocx(id, includeGenerated),
    onSuccess: (blob) => {
      if (report) saveBlobAsFile(blob, `${report.report_no}-${report.title}.docx`);
    }
  });

  const defects = report?.defects ?? [];
  const summary = report?.summary ?? {};
  const canPush = canManageReports && !isTrialResult && report?.status === "generated";

  const defectTypeSummary = useMemo(
    () => Object.entries(summary.by_defect_type ?? {}),
    [summary.by_defect_type]
  );
  const modelOutputText = useMemo(
    () => formatModelOutputs(report?.raw_model_outputs),
    [report?.raw_model_outputs]
  );
  const tileTokenText = useMemo(
    () => hasTileTokenUsages(report?.raw_model_outputs)
      ? formatTileTokenUsages(report?.raw_model_outputs)
      : null,
    [report?.raw_model_outputs]
  );
  const canShowModelOutputs = user?.role === "admin" && hasModelOutputs(report?.raw_model_outputs);

  if (reportQuery.isLoading) {
    return (
      <div className="grid gap-5">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-80 rounded-lg" />
      </div>
    );
  }

  if (reportQuery.isError || !report) {
    return (
      <div className="grid min-h-[calc(100svh-8rem)] place-items-center">
        <Card className="w-full max-w-2xl rounded-lg border border-red-200 shadow-none">
          <CardBody className="gap-4 p-6">
            <h1 className="text-xl font-black text-ink">结果加载失败</h1>
            <p className="text-sm font-bold text-red-700">
              {getErrorMessage(reportQuery.error)}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                className="w-fit rounded-lg bg-primary font-bold text-white shadow-none"
                onPress={() => void reportQuery.refetch()}
              >
                重新加载
              </Button>
              <Button
                as={RouterLink}
                className="report-back-button w-fit rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
                to="/reports"
                variant="flat"
              >
                返回列表
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (isTrialResult) {
    return (
      <TrialResultDetail
        report={report}
        canShowTile={canShowTile}
      />
    );
  }

  return (
    <>
    <div className="grid gap-5 pb-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase text-action">Detection Result</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-black text-ink">{report.title}</h1>
            <StatusPill tone={REPORT_STATUS_TONES[report.status]}>
              {REPORT_STATUS_LABELS[report.status]}
            </StatusPill>
          </div>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-7 text-slate-600">
            {report.report_no} · {report.project.name || "未命名项目"}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            as={RouterLink}
            className="report-back-button rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
            startContent={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
            to={includeGenerated ? "/review" : "/reports"}
            variant="flat"
          >
            {includeGenerated ? "返回工作台" : "返回列表"}
          </Button>
          <Button
            className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
            isLoading={downloadMutation.isPending}
            startContent={<Download className="h-4 w-4" aria-hidden="true" />}
            variant="flat"
            onPress={() => {
              if (confirmReportExport()) downloadMutation.mutate();
            }}
          >
            下载 DOCX
          </Button>
          {canManageReports ? (
            <Button
              className="rounded-lg font-bold"
              color="primary"
              isDisabled={!canPush || pushMutation.isPending}
              isLoading={pushMutation.isPending}
              startContent={<Send className="h-4 w-4" aria-hidden="true" />}
              onPress={() => {
                const confirmed = window.confirm("确认推送报告？推送后普通用户可查看最终报告。");
                if (confirmed) pushMutation.mutate();
              }}
            >
              推送报告
            </Button>
          ) : null}
        </div>
      </section>
      <p className="report-export-privacy-note" role="note">
        报告可能包含项目位置和检测照片；导出后请限制接收范围并安全保管。
        <RouterLink to="/privacy">查看隐私政策</RouterLink>
      </p>

      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          {message}
        </div>
      ) : null}

      {pushMutation.isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {getErrorMessage(pushMutation.error)}
        </div>
      ) : null}

      {downloadMutation.isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          DOCX 下载失败：{getErrorMessage(downloadMutation.error)}
          <button className="ml-2 underline" type="button" onClick={() => downloadMutation.mutate()}>重试</button>
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        <MetricBlock label="缺陷总数" value={String(summary.total_review_results ?? defects.length)} />
        <MetricBlock label="照片数量" value={String(summary.photo_count ?? report.photos.length)} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-5">
          <Card className="rounded-lg border border-slate-200 shadow-none">
            <CardBody className="gap-0 p-0">
              <SectionHeader
                icon={<FileText className="h-5 w-5" aria-hidden="true" />}
                title="结果概览"
                subtitle="结果内容来自审核完成时固化的数据"
              />
              <Divider />
              <div className="grid gap-4 p-5 md:grid-cols-2">
                <InfoItem label="报告名称" value={report.title} />
                <InfoItem label="项目名称" value={report.project.name} />
                <InfoItem label="项目编号" value={report.project.project_no || report.report_no} />
                <InfoItem label="委托单位" value={report.project.client_name} />
                <InfoItem
                  label="项目地址"
                  value={[
                    report.project.province,
                    report.project.city,
                    report.project.district,
                    report.project.address
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
                <InfoItem label="生成时间" value={formatDateTime(report.generated_at)} />
                <InfoItem label="推送时间" value={formatDateTime(report.pushed_at)} />
              </div>
            </CardBody>
          </Card>

          <Card className="rounded-lg border border-slate-200 shadow-none">
            <CardBody className="gap-0 p-0">
              <SectionHeader
                icon={<FileImage className="h-5 w-5" aria-hidden="true" />}
                title="检测结果明细"
                subtitle="标注框坐标按原图像素记录"
                action={canShowModelOutputs ? (
                  <button
                    className="model-output-link"
                    type="button"
                    onClick={() => setIsModelOutputOpen(true)}
                  >
                    模型原始输出
                  </button>
                ) : null}
              />
              <Divider />
              {defects.length ? (
                <div className="overflow-x-auto">
                  <table className="min-w-[1120px] w-full border-separate border-spacing-0 text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                      <tr>
                        <th className="border-b border-slate-200 px-5 py-3">图片</th>
                        <th className="border-b border-slate-200 px-5 py-3">缺陷</th>
                        <th className="border-b border-slate-200 px-5 py-3">标注框</th>
                        <th className="border-b border-slate-200 px-5 py-3">严重度</th>
                        <th className="border-b border-slate-200 px-5 py-3">置信度</th>
                        <th className="border-b border-slate-200 px-5 py-3">审核备注</th>
                      </tr>
                    </thead>
                    <tbody>
                      {defects.map((defect, index) => (
                        <DefectRow key={defect.id || index} defect={defect} />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="grid min-h-48 place-items-center p-6 text-center">
                  <div>
                    <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" aria-hidden="true" />
                    <h2 className="mt-3 text-lg font-black text-ink">暂无识别明细</h2>
                    <p className="mt-2 text-sm font-semibold text-slate-500">
                      当前结果没有固化的识别记录。
                    </p>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <aside className="grid h-fit gap-5">
          <Card className="rounded-lg border border-slate-200 shadow-none">
            <CardBody className="gap-4 p-5">
              <h2 className="text-lg font-black text-ink">检测配置</h2>
              <InfoItem
                label="模型类型"
                value={(report.detection_config?.model_types ?? [])
                  .map((type) => DEFECT_LABELS[type] ?? type)
                  .join("、")}
              />
              <InfoItem
                label="高精度检测"
                value={report.detection_config?.high_precision ? "已开启" : "未开启"}
              />
              <InfoItem label="任务编号" value={report.detection_task?.task_no} />
              <InfoItem label="模型版本" value={report.detection_task?.model_version} />
            </CardBody>
          </Card>

          <Card className="rounded-lg border border-slate-200 shadow-none">
            <CardBody className="gap-4 p-5">
              <h2 className="text-lg font-black text-ink">缺陷统计</h2>
              {defectTypeSummary.length ? (
                <div className="grid gap-2">
                  {defectTypeSummary.map(([type, count]) => (
                    <div
                      key={type}
                      className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <span className="text-sm font-bold text-slate-600">
                        {DEFECT_LABELS[type] ?? type}
                      </span>
                      <strong className="text-sm font-black text-ink">{count}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm font-semibold text-slate-500">暂无缺陷统计。</p>
              )}
            </CardBody>
          </Card>

        </aside>
      </section>
    </div>
    {canShowModelOutputs && isModelOutputOpen ? (
      <ModelOutputDialog
        text={modelOutputText}
        tileTokenText={tileTokenText}
        onClose={() => setIsModelOutputOpen(false)}
      />
    ) : null}
    </>
  );
}

function TrialResultDetail({
  report,
  canShowTile
}: {
  report: ReportDetail;
  canShowTile: boolean;
}) {
  const [annotatedPreview, setAnnotatedPreview] = useState<TrialReportAnnotatedPreview | null>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const previewDrag = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const previewDragMoved = useRef(false);
  const [tilePreview, setTilePreview] = useState<TilePreviewSource | null>(null);
  const pdfMutation = useMutation({
    mutationFn: () => downloadTrialReportPdf(report.id),
    onSuccess: (blob) => {
      saveBlobAsFile(blob, `${report.report_no}-${report.title}.pdf`);
    }
  });
  const resultRows = useMemo(() => buildTrialResultRows(report), [report]);
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
    <div className="trial-result-detail-page">
      <div className="trial-result-toolbar">
        <div className="trial-result-title-block">
          <div className="trial-result-name-row management-page-title">
            <FileCheck2 aria-hidden="true" className="management-page-title-icon" />
            <h1>{report.title || report.project.project_no || report.report_no}</h1>
          </div>
          <p className="trial-result-generated-at">
            <span>生成于</span>
            <time dateTime={report.generated_at}>{formatDateTime(report.generated_at)}</time>
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            aria-busy={pdfMutation.isPending}
            className="button secondary report-back-button report-export-button"
            disabled={pdfMutation.isPending}
            type="button"
            onClick={() => {
              if (confirmReportExport()) pdfMutation.mutate();
            }}
          >
            <Download aria-hidden="true" />
            {pdfMutation.isPending ? "正在导出" : "导出 PDF"}
          </button>
          <RouterLink className="button secondary report-back-button" to="/reports">
            <ArrowLeft aria-hidden="true" />返回列表
          </RouterLink>
        </div>
      </div>
      {pdfMutation.isError ? (
        <p className="project-list-error">PDF 导出失败：{getErrorMessage(pdfMutation.error)}<button className="inline-retry-button" type="button" onClick={() => pdfMutation.mutate()}>重试</button></p>
      ) : null}
      <div className="trial-experience-shell trial-experience-content-shell trial-result-detail-shell">
        <section className="trial-experience-grid">
          <aside className="trial-report-panel">
            <div className="trial-report-result">
              <div className="trial-report-head">
                <div className="trial-report-title-row">
                  <h2>检测结果明细</h2>
                  <small className="trial-result-review-note">AI检测不能替代现场复核</small>
                </div>
              </div>
              {resultRows.length ? (
                <div className="trial-report-table-wrap">
                  <table
                    className={`trial-report-table${canShowTile ? "" : " trial-report-table--without-tile"}`}
                  >
                    {!canShowTile ? (
                      <colgroup>
                        <col className="trial-sequence-col" />
                        <col className="trial-photo-col" />
                        <col className="trial-description-col" />
                      </colgroup>
                    ) : null}
                    <thead>
                      <tr>
                        <th className="trial-sequence-column">序号</th>
                        <th className="trial-photo-column">含标注的照片</th>
                        <th className="trial-report-description">检测说明</th>
                        {canShowTile ? <th className="trial-tile-column">tile</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {resultRows.map((row, index) => (
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
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="trial-report-empty">
                  <CheckCircle2 aria-hidden="true" />
                  <h2>暂无识别结果</h2>
                  <p>简易检测归档中没有可展示的检测结果。</p>
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
  detections?: ModelOutputPhoto["detections"];
  defects: ReportDefectSnapshot[];
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
  const canPreview = Boolean(row.imageUrl);
  const summary = trialResultDefectSummary(row.defects);

  function previewAnnotatedPhoto() {
    if (!row.imageUrl) return;
    onPreview({ filename: row.filename, imageUrl: row.imageUrl, defects: row.defects });
  }

  return (
    <tr>
      <td className="trial-sequence-column">
        <span className="trial-report-index">
          {String(index + 1).padStart(2, "0")}
        </span>
      </td>
      <td className="trial-photo-column">
        <figure className="trial-annotated-photo-frame">
          <div
            className={`trial-annotated-photo ${row.imageUrl ? "" : "trial-annotated-photo-placeholder"} ${canPreview ? "is-clickable" : ""}`}
            title={canPreview ? "点击放大查看" : undefined}
            onClick={previewAnnotatedPhoto}
          >
            {row.imageUrl ? <img alt={`${row.filename} 检测标注`} src={row.imageUrl} /> : <FileImage aria-hidden="true" />}
            {row.defects.map((defect, defectIndex) => (
              <TrialReportDefectBox
                key={defect.id || `${defect.defect_type}-${defectIndex}`}
                defect={defect}
              />
            ))}
            {canPreview ? (
              <div className="trial-annotated-photo-actions">
                <button
                  type="button"
                  aria-label="放大查看含标注的照片"
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
          <figcaption>{row.filename}</figcaption>
        </figure>
      </td>
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
      {canShowTile ? (
        <td className="trial-tile-column">
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
            查看tile
          </button>
        </td>
      ) : null}
    </tr>
  );
}

function TrialReportDefectBox({ defect }: { defect: ReportDefectSnapshot }) {
  const defectDisplay = trialDefectDisplayFromType(defect.defect_type);
  const boxStyle = trialReportDefectBoxStyle(defect);
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

function trialReportDefectBoxStyle(defect: ReportDefectSnapshot): CSSProperties | undefined {
  const bbox = defect.bbox_json;
  const x = finiteNumber(bbox?.x);
  const y = finiteNumber(bbox?.y);
  const width = finiteNumber(bbox?.width);
  const height = finiteNumber(bbox?.height);
  const imageWidth = finiteNumber(defect.raw_result_json?.finding?.image_width);
  const imageHeight = finiteNumber(defect.raw_result_json?.finding?.image_height);

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
      detections: undefined,
      defects: rowDefects
    });
  }

  return rows;
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

function DefectRow({ defect }: { defect: ReportDefectSnapshot }) {
  const bbox = defect.bbox_json ?? {};
  const imageUrl = defect.photo_thumbnail_url || defect.photo_preview_url;

  return (
    <tr className="align-middle hover:bg-slate-50">
      <td className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          {imageUrl ? (
            <img
              alt={defect.photo_filename || "缺陷图片"}
              className="h-14 w-20 rounded-md border border-slate-200 object-cover"
              src={imageUrl}
            />
          ) : (
            <span className="grid h-14 w-20 place-items-center rounded-md border border-slate-200 bg-slate-50 text-slate-400">
              <FileImage className="h-5 w-5" aria-hidden="true" />
            </span>
          )}
          <span className="max-w-48 truncate text-xs font-semibold text-slate-500">
            {defect.photo_filename || "-"}
          </span>
        </div>
      </td>
      <td className="border-b border-slate-100 px-5 py-4">
        <p className="font-black text-ink">
          {DEFECT_LABELS[defect.defect_type || ""] ?? defect.defect_type ?? "-"}
        </p>
        <p className="mt-1 text-xs font-bold text-slate-500">
          {REVIEW_STATUS_LABELS[defect.status || ""] ?? defect.status ?? "-"}
        </p>
      </td>
      <td className="border-b border-slate-100 px-5 py-4 font-mono text-xs font-semibold text-slate-600">
        x {bbox.x ?? "-"} · y {bbox.y ?? "-"} · w {bbox.width ?? "-"} · h {bbox.height ?? "-"}
      </td>
      <td className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-600">
        {defect.severity || "-"}
      </td>
      <td className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-600">
        {confidenceText(defect.confidence)}
      </td>
      <td className="border-b border-slate-100 px-5 py-4 text-sm font-semibold text-slate-600">
        {defect.review_note || "-"}
      </td>
    </tr>
  );
}

function SectionHeader({
  icon,
  title,
  subtitle,
  action
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-action-soft text-action">
        {icon}
      </span>
      <div>
        <div className="model-output-title-row">
          <h2 className="text-lg font-black text-ink">{title}</h2>
          {action}
        </div>
        <p className="mt-1 text-xs font-bold text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <p className="text-xs font-black uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-bold text-slate-700">{value || "-"}</p>
    </div>
  );
}

function MetricBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-black uppercase text-slate-500">{label}</p>
      <strong className="mt-2 block text-2xl font-black text-ink">{value}</strong>
    </div>
  );
}

function confidenceText(value: string | null | undefined) {
  if (!value) return "-";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric * 100)}%` : value;
}
