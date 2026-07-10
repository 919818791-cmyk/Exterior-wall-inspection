import { Button, Card, CardBody, Divider, Skeleton } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileImage,
  FileText,
  Send,
  ZoomIn
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useMemo, useState } from "react";
import { Link as RouterLink, useParams, useSearchParams } from "react-router-dom";

import { downloadReportDocx, pushReport, reportQueryOptions } from "@/api/reports";
import { ModelOutputDialog } from "@/components/ModelOutputDialog";
import { TilePreviewDialog, type TilePreviewSource } from "@/components/TilePreviewDialog";
import { StatusPill } from "@/components/StatusPill";
import type {
  ModelOutputPhoto,
  ReportBuildingSnapshot,
  ReportDefectSnapshot,
  ReportDetail
} from "@/types/reports";
import { useAuthStore } from "@/stores/useAuthStore";
import { formatDateTime } from "@/utils/projectDisplay";
import { saveBlobAsFile } from "@/utils/download";
import { formatModelOutputs, hasModelOutputs } from "@/utils/modelOutputs";
import { trialDefectBoxLabel, trialDefectDescriptionFromType, trialDefectDisplayFromType } from "@/utils/trialDefectDisplay";

const DEFECT_LABELS: Record<string, string> = {
  crack: "裂缝",
  missing: "剥落",
  spalling: "剥落",
  moisture: "潮湿"
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function ReportDetailPage() {
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const canManageReports = user?.role === "reviewer" || user?.role === "admin";
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
  const canShowModelOutputs = hasModelOutputs(report?.raw_model_outputs);

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
            <Button
              as={RouterLink}
              className="w-fit rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
              to="/reports"
              variant="flat"
            >
              返回结果列表
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (isTrialResult) {
    return (
      <TrialResultDetail report={report} />
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
            className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
            startContent={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
            to={includeGenerated ? "/review" : "/reports"}
            variant="flat"
          >
            {includeGenerated ? "返回工作台" : "返回结果列表"}
          </Button>
          <Button
            className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
            isLoading={downloadMutation.isPending}
            startContent={<Download className="h-4 w-4" aria-hidden="true" />}
            variant="flat"
            onPress={() => downloadMutation.mutate()}
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

      <section className="grid gap-4 lg:grid-cols-4">
        <MetricBlock label="缺陷总数" value={String(summary.total_review_results ?? defects.length)} />
        <MetricBlock label="照片数量" value={String(summary.photo_count ?? report.photos.length)} />
        <MetricBlock label="建筑数量" value={String(summary.building_count ?? report.buildings.length)} />
        <MetricBlock label="立面数量" value={String(summary.facade_count ?? countFacades(report.buildings))} />
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
                <InfoItem label="联系人" value={report.project.contact_name} />
                <InfoItem label="联系电话" value={report.project.contact_phone} />
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
                        <th className="border-b border-slate-200 px-5 py-3">位置</th>
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

          <Card className="rounded-lg border border-slate-200 shadow-none">
            <CardBody className="gap-4 p-5">
              <h2 className="text-lg font-black text-ink">建筑与立面</h2>
              {report.buildings.length ? (
                <div className="grid gap-3">
                  {report.buildings.map((building, index) => (
                    <BuildingBlock key={building.id || index} building={building} />
                  ))}
                </div>
              ) : (
                <p className="text-sm font-semibold text-slate-500">暂无建筑信息。</p>
              )}
            </CardBody>
          </Card>
        </aside>
      </section>
    </div>
    {isModelOutputOpen ? (
      <ModelOutputDialog
        text={modelOutputText}
        onClose={() => setIsModelOutputOpen(false)}
      />
    ) : null}
    </>
  );
}

function TrialResultDetail({ report }: { report: ReportDetail }) {
  const [annotatedPreview, setAnnotatedPreview] = useState<TrialReportAnnotatedPreview | null>(null);
  const [photoPreview, setPhotoPreview] = useState<TrialReportPhotoPreview | null>(null);
  const [isModelOutputOpen, setIsModelOutputOpen] = useState(false);
  const [tilePreview, setTilePreview] = useState<TilePreviewSource | null>(null);
  const resultRows = useMemo(() => buildTrialResultRows(report), [report]);
  const modelOutputText = useMemo(
    () => formatModelOutputs(report.raw_model_outputs),
    [report.raw_model_outputs]
  );
  const canShowModelOutputs = hasModelOutputs(report.raw_model_outputs);

  return (
    <div className="trial-result-detail-page">
      <div className="trial-result-toolbar">
        <div className="trial-result-title-block">
          <h1>{report.title || "简易AI检测结果"}</h1>
          <p>生成时间：{formatDateTime(report.generated_at)}</p>
        </div>
        <RouterLink className="button secondary" to="/reports">
          <ArrowLeft aria-hidden="true" />返回结果列表
        </RouterLink>
      </div>
      <div className="trial-experience-shell trial-experience-content-shell trial-result-detail-shell">
        <section className="trial-experience-grid">
          <div className="trial-upload-panel">
            <div className="trial-panel-heading">
              <div>
                <h2>检测照片</h2>
              </div>
            </div>
            {report.photos.length ? (
              <div className="trial-photo-grid trial-result-photo-grid">
                {report.photos.map((photo, index) => {
                  const filename = photo.original_filename || "未命名照片";
                  const canPreview = Boolean(photo.preview_url);

                  return (
                    <figure
                      key={photo.id || `${photo.original_filename}-${index}`}
                      className={`trial-photo-thumb ${canPreview ? "is-previewable" : ""}`}
                    >
                      <div
                        className="trial-photo-thumb-image"
                        title={canPreview ? "点击放大查看" : undefined}
                        onClick={() => {
                          if (photo.preview_url) {
                            setPhotoPreview({ filename, imageUrl: photo.preview_url });
                            setAnnotatedPreview(null);
                          }
                        }}
                      >
                        {photo.preview_url ? (
                          <img alt={filename} src={photo.preview_url} />
                        ) : (
                          <div className="trial-result-photo-placeholder"><FileImage aria-hidden="true" /></div>
                        )}
                        {photo.thermal_imaging_available ? (
                          <span className="trial-thermal-available-tag">热成像可用</span>
                        ) : null}
                        {canPreview ? (
                          <div className="trial-photo-thumb-actions">
                            <button
                              type="button"
                              aria-label="放大查看检测照片"
                              title="放大查看"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (photo.preview_url) {
                                  setPhotoPreview({ filename, imageUrl: photo.preview_url });
                                  setAnnotatedPreview(null);
                                }
                              }}
                            >
                              <ZoomIn aria-hidden="true" />
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <figcaption>{filename}</figcaption>
                    </figure>
                  );
                })}
              </div>
            ) : (
              <div className="trial-result-photo-empty">
                <FileImage aria-hidden="true" />
                <strong>暂无检测结果</strong>
              </div>
            )}
          </div>

          <aside className="trial-report-panel">
            <div className="trial-report-result">
              <div className="trial-report-head">
                <div className="trial-report-title-row">
                  <h2>检测结果明细</h2>
                  {canShowModelOutputs ? (
                    <button
                      className="model-output-link"
                      type="button"
                      onClick={() => setIsModelOutputOpen(true)}
                    >
                      模型原始输出
                    </button>
                  ) : null}
                </div>
              </div>
              {resultRows.length ? (
                <div className="trial-report-table-wrap">
                  <table className="trial-report-table">
                    <thead>
                      <tr>
                        <th>序号</th>
                        <th>含标注的照片</th>
                        <th>检测说明</th>
                        <th>tile</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultRows.map((row, index) => (
                        <TrialResultRow
                          key={row.key}
                          row={row}
                          index={index}
                          onPreview={(preview) => {
                            setAnnotatedPreview(preview);
                            setPhotoPreview(null);
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
      {annotatedPreview || photoPreview ? (
        <div
          className="trial-photo-preview-modal"
          role="dialog"
          aria-modal="true"
          aria-label={annotatedPreview ? "含标注的照片预览" : "检测照片预览"}
          onClick={() => {
            setAnnotatedPreview(null);
            setPhotoPreview(null);
          }}
        >
          <figure onClick={(event) => event.stopPropagation()}>
            {annotatedPreview ? (
              <div className="trial-annotated-photo trial-photo-preview-annotated">
                <img alt={`${annotatedPreview.filename} 检测标注预览`} src={annotatedPreview.imageUrl} />
                {annotatedPreview.defects.map((defect, defectIndex) => (
                  <TrialReportDefectBox
                    key={defect.id || `${defect.defect_type}-${defectIndex}`}
                    defect={defect}
                  />
                ))}
              </div>
            ) : photoPreview ? (
              <img alt={`${photoPreview.filename} 预览`} src={photoPreview.imageUrl} />
            ) : null}
            <figcaption>{annotatedPreview?.filename ?? photoPreview?.filename}</figcaption>
          </figure>
        </div>
      ) : null}
      {isModelOutputOpen ? (
        <ModelOutputDialog
          text={modelOutputText}
          onClose={() => setIsModelOutputOpen(false)}
        />
      ) : null}
      {tilePreview ? (
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

interface TrialReportPhotoPreview {
  filename: string;
  imageUrl: string;
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
  onPreview,
  onTilePreview
}: {
  row: TrialResultPhotoRow;
  index: number;
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
      <td>
        <span className="trial-report-index">
          {String(index + 1).padStart(2, "0")}
        </span>
      </td>
      <td>
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
        {trialDefectBoxLabel(defectDisplay, defect.confidence)}
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
      <td className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-600">
        {(defect.building_name || "-") + " / " + (defect.facade_name || "-")}
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

function BuildingBlock({ building }: { building: ReportBuildingSnapshot }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="font-black text-ink">{building.name || "未命名建筑"}</p>
      <p className="mt-1 text-xs font-semibold text-slate-500">
        楼层 {building.floors ?? "-"} · 高度 {building.height ?? "-"}
      </p>
      {building.facades?.length ? (
        <div className="mt-3 grid gap-2">
          {building.facades.map((facade, index) => (
            <div
              key={facade.id || index}
              className="rounded-md bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600"
            >
              {facade.name || "未命名立面"} · {facade.floors_range || "-"} · {facade.area || "-"}
            </div>
          ))}
        </div>
      ) : null}
    </div>
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

function countFacades(buildings: ReportBuildingSnapshot[]) {
  return buildings.reduce((sum, building) => sum + (building.facades?.length ?? 0), 0);
}

function confidenceText(value: string | null | undefined) {
  if (!value) return "-";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric * 100)}%` : value;
}
