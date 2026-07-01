import { Button, Card, CardBody, Divider, Skeleton } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileImage,
  FileText,
  Send
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Link as RouterLink, useParams, useSearchParams } from "react-router-dom";

import { downloadReportDocx, pushReport, reportQueryOptions } from "@/api/reports";
import { StatusPill } from "@/components/StatusPill";
import type {
  ReportBuildingSnapshot,
  ReportDefectSnapshot,
  ReportDetail
} from "@/types/reports";
import { useAuthStore } from "@/stores/useAuthStore";
import { formatDateTime } from "@/utils/projectDisplay";
import { saveBlobAsFile } from "@/utils/download";

const DEFECT_LABELS: Record<string, string> = {
  crack: "裂缝",
  spalling: "剥落",
  hollowing: "空鼓",
  leakage: "渗漏",
  corrosion: "锈蚀"
};

const REVIEW_STATUS_LABELS: Record<string, string> = {
  generated: "体验生成",
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

const TRIAL_RESULT_DESCRIPTION_LINES = [
  { className: "trial-report-description-spalling", text: "疑似剥落: 1处" },
  { className: "trial-report-description-crack", text: "疑似开裂: 1处" }
] as const;

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
  const reportQuery = useQuery(reportQueryOptions(id, includeGenerated));
  const report = reportQuery.data;
  const [message, setMessage] = useState("");
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
                title="缺陷明细"
                subtitle="标注框坐标按原图像素记录"
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
  );
}

function TrialResultDetail({ report }: { report: ReportDetail }) {
  const defects = report.defects ?? [];
  const rows = defects.length ? defects : report.photos.map((photo) => ({
    id: photo.id,
    photo_id: photo.id,
    photo_filename: photo.original_filename,
    photo_preview_url: photo.preview_url,
    photo_thumbnail_url: photo.thumbnail_url
  }));

  return (
    <div className="trial-result-detail-page">
      <div className="trial-result-toolbar">
        <div className="trial-result-title-block">
          <h1>{report.title || "AI检测体验结果"}</h1>
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
                {report.photos.map((photo, index) => (
                  <figure key={photo.id || `${photo.original_filename}-${index}`} className="trial-photo-thumb">
                    <div className="trial-photo-thumb-image">
                      {photo.preview_url ? (
                        <img alt={photo.original_filename || "检测结果照片"} src={photo.preview_url} />
                      ) : (
                        <div className="trial-result-photo-placeholder"><FileImage aria-hidden="true" /></div>
                      )}
                      {photo.thermal_imaging_available ? (
                        <span className="trial-hollow-available-tag">空鼓可用</span>
                      ) : null}
                    </div>
                    <figcaption>{photo.original_filename || "未命名照片"}</figcaption>
                  </figure>
                ))}
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
                <div>
                  <h2>检测结果明细</h2>
                </div>
              </div>
              {rows.length ? (
                <div className="trial-report-table-wrap">
                  <table className="trial-report-table">
                    <thead>
                      <tr>
                        <th>序号</th>
                        <th>含标注的照片</th>
                        <th>检测说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((defect, index) => (
                        <TrialResultRow
                          key={defect.id || `${defect.photo_filename}-${index}`}
                          defect={defect}
                          index={index}
                          photo={findTrialPhoto(report, defect)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="trial-report-empty">
                  <CheckCircle2 aria-hidden="true" />
                  <h2>暂无识别结果</h2>
                  <p>体验归档中没有可展示的检测结果。</p>
                </div>
              )}
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}

function TrialResultRow({
  defect,
  index,
  photo
}: {
  defect: ReportDefectSnapshot;
  index: number;
  photo?: ReportDetail["photos"][number];
}) {
  const imageUrl = defect.photo_preview_url || defect.photo_thumbnail_url || photo?.preview_url || photo?.thumbnail_url;
  const filename = defect.photo_filename || photo?.original_filename || "检测结果照片";

  return (
    <tr>
      <td>{String(index + 1).padStart(2, "0")}</td>
      <td>
        <figure className="trial-annotated-photo-frame">
          <div className={`trial-annotated-photo ${imageUrl ? "" : "trial-annotated-photo-placeholder"}`}>
            {imageUrl ? <img alt={`${filename} 检测标注`} src={imageUrl} /> : <FileImage aria-hidden="true" />}
            <span className={`trial-defect-box trial-defect-box-${index % 3}`} />
          </div>
          <figcaption>{filename}</figcaption>
        </figure>
      </td>
      <td className="trial-report-description">
        <p>
          {TRIAL_RESULT_DESCRIPTION_LINES.map((line) => (
            <span key={line.text} className={line.className}>{line.text}</span>
          ))}
        </p>
      </td>
    </tr>
  );
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
  subtitle
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-action-soft text-action">
        {icon}
      </span>
      <div>
        <h2 className="text-lg font-black text-ink">{title}</h2>
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
