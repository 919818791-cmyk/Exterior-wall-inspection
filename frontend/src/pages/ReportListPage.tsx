import { Button, Card, CardBody, Divider, Skeleton } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Eye, FileText, RefreshCcw } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";

import { downloadReportDocx, reportsQueryOptions } from "@/api/reports";
import { StatusPill } from "@/components/StatusPill";
import type { ReportListItem } from "@/types/reports";
import { formatDateTime } from "@/utils/projectDisplay";
import { saveBlobAsFile } from "@/utils/download";

const REPORT_STATUS_LABELS = {
  draft: "草稿",
  generated: "已生成",
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

export function ReportListPage() {
  const reportsQuery = useQuery(reportsQueryOptions);
  const reports = reportsQuery.data ?? [];

  return (
    <div className="grid gap-5">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase text-action">Reports</p>
          <h1 className="mt-2 text-3xl font-black text-ink">检测报告</h1>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-7 text-slate-600">
            查看已推送给普通用户的最终报告，支持在线预览和 DOCX 下载。
          </p>
        </div>
        <Button
          className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
          isLoading={reportsQuery.isFetching}
          startContent={<RefreshCcw className="h-4 w-4" aria-hidden="true" />}
          variant="flat"
          onPress={() => void reportsQuery.refetch()}
        >
          刷新
        </Button>
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        <MetricBlock label="已推送报告" value={String(reports.length)} />
        <MetricBlock
          label="缺陷总数"
          value={String(reports.reduce((sum, report) => sum + report.total_defects, 0))}
        />
        <MetricBlock
          label="今日生成"
          value={String(reports.filter((report) => isToday(report.generated_at)).length)}
        />
        <MetricBlock
          label="待下载文件"
          value={String(reports.filter((report) => report.status === "pushed").length)}
        />
      </section>

      <Card className="rounded-lg border border-slate-200 shadow-none">
        <CardBody className="gap-0 p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <h2 className="text-lg font-black text-ink">报告列表</h2>
              <p className="mt-1 text-xs font-bold text-slate-500">
                普通用户侧只展示已推送报告。
              </p>
            </div>
          </div>
          <Divider />

          {reportsQuery.isLoading ? (
            <div className="grid gap-3 p-5">
              <Skeleton className="h-12 rounded-lg" />
              <Skeleton className="h-12 rounded-lg" />
              <Skeleton className="h-12 rounded-lg" />
            </div>
          ) : reportsQuery.isError ? (
            <div className="p-5">
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                {getErrorMessage(reportsQuery.error)}
              </div>
            </div>
          ) : reports.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-[1080px] w-full border-separate border-spacing-0 text-left text-sm">
                <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                  <tr>
                    <th className="border-b border-slate-200 px-5 py-3">报告</th>
                    <th className="border-b border-slate-200 px-5 py-3">关联项目</th>
                    <th className="border-b border-slate-200 px-5 py-3">委托单位</th>
                    <th className="border-b border-slate-200 px-5 py-3">缺陷</th>
                    <th className="border-b border-slate-200 px-5 py-3">状态</th>
                    <th className="border-b border-slate-200 px-5 py-3">生成时间</th>
                    <th className="border-b border-slate-200 px-5 py-3">推送时间</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => (
                    <ReportRow key={report.id} report={report} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid min-h-72 place-items-center p-6 text-center">
              <div>
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-action-soft text-action">
                  <FileText className="h-6 w-6" aria-hidden="true" />
                </span>
                <h2 className="mt-4 text-xl font-black text-ink">暂无已推送报告</h2>
                <p className="mt-2 text-sm font-semibold text-slate-500">
                  审核人员推送后，普通用户会在这里查看最终报告。
                </p>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function ReportRow({ report }: { report: ReportListItem }) {
  const downloadMutation = useMutation({
    mutationFn: () => downloadReportDocx(report.id),
    onSuccess: (blob) => saveBlobAsFile(blob, `${report.report_no}-${report.title}.docx`)
  });

  return (
    <tr className="align-middle hover:bg-slate-50">
      <td className="border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <p className="truncate font-black text-ink">{report.title}</p>
          <p className="mt-1 font-mono text-xs font-semibold text-slate-500">
            {report.report_no}
          </p>
        </div>
      </td>
      <td className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-600">
        {report.project_name}
      </td>
      <td className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-600">
        {report.client_name || "-"}
      </td>
      <td className="border-b border-slate-100 px-5 py-4 font-black text-slate-700">
        {report.total_defects}
      </td>
      <td className="border-b border-slate-100 px-5 py-4">
        <StatusPill tone={REPORT_STATUS_TONES[report.status]}>
          {REPORT_STATUS_LABELS[report.status]}
        </StatusPill>
      </td>
      <td className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-600">
        {formatDateTime(report.generated_at)}
      </td>
      <td className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-600">
        {formatDateTime(report.pushed_at)}
      </td>
      <td className="border-b border-slate-100 px-5 py-4">
        <div className="flex justify-end gap-2">
          <Button
            as={RouterLink}
            className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
            size="sm"
            startContent={<Eye className="h-4 w-4" aria-hidden="true" />}
            to={`/reports/${report.id}`}
            variant="flat"
          >
            详情
          </Button>
          <Button
            className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
            isLoading={downloadMutation.isPending}
            size="sm"
            startContent={<Download className="h-4 w-4" aria-hidden="true" />}
            variant="flat"
            onPress={() => downloadMutation.mutate()}
          >
            DOCX
          </Button>
        </div>
      </td>
    </tr>
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

function isToday(value: string) {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString();
}
