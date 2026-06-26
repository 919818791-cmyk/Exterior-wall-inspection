import { Button, Card, CardBody, Divider, Link, Skeleton } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  Database,
  HardDriveUpload,
  RadioTower,
  RefreshCcw,
  Server
} from "lucide-react";
import { Link as RouterLink } from "react-router-dom";

import { API_BASE_URL } from "@/api/client";
import { healthQueryOptions } from "@/api/health";
import { StatusPill } from "@/components/StatusPill";

const readinessItems = [
  {
    title: "PostgreSQL",
    description: "项目、照片、任务、审核和报告数据的主存储。",
    icon: Database
  },
  {
    title: "MinIO",
    description: "无人机照片、缩略图和报告 DOCX 的对象存储。",
    icon: HardDriveUpload
  },
  {
    title: "Redis / RQ",
    description: "预留算法任务排队和异步处理能力。",
    icon: Boxes
  },
  {
    title: "算法 Worker",
    description: "通过 API 拉取任务、调用模型并回传 JSON。",
    icon: RadioTower
  }
];

export function DashboardPage() {
  const healthQuery = useQuery(healthQueryOptions);
  const health = healthQuery.data;
  const apiReady = healthQuery.isSuccess && health?.status === "ok";

  return (
    <div className="grid gap-6">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="grid min-h-[300px] gap-6 bg-[linear-gradient(90deg,rgba(247,251,255,0.98)_0%,rgba(247,251,255,0.9)_43%,rgba(247,251,255,0.34)_72%),url('/hero-facade.png')] bg-cover bg-center p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex max-w-3xl flex-col justify-center">
            <p className="mb-3 text-sm font-black text-action">平台基础工程</p>
            <h1 className="max-w-2xl text-3xl font-black leading-tight text-ink sm:text-4xl">
              外墙巡检业务框架已就绪
            </h1>
            <p className="mt-4 max-w-2xl text-base font-medium leading-8 text-slate-600">
              前端路由、API 请求、后端健康检查、数据库配置、对象存储和 Worker 契约已完成基础接线。
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                as={RouterLink}
                className="rounded-lg font-bold"
                color="primary"
                to="/trial"
              >
                立即试用
              </Button>
              <Button
                as={RouterLink}
                className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
                to="/projects"
                variant="flat"
              >
                进入项目管理
              </Button>
            </div>
          </div>

          <Card className="self-end rounded-lg border border-slate-200 bg-white/95 shadow-none">
            <CardBody className="gap-4 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase text-slate-500">API Health</p>
                  <h2 className="mt-1 text-xl font-black text-ink">后端连接状态</h2>
                </div>
                {apiReady ? (
                  <StatusPill tone="success">正常</StatusPill>
                ) : healthQuery.isLoading ? (
                  <StatusPill tone="warning">检查中</StatusPill>
                ) : (
                  <StatusPill tone="danger">未连接</StatusPill>
                )}
              </div>

              <Divider />

              {healthQuery.isLoading ? (
                <div className="grid gap-3">
                  <Skeleton className="h-4 rounded-md" />
                  <Skeleton className="h-4 rounded-md" />
                  <Skeleton className="h-4 rounded-md" />
                </div>
              ) : health ? (
                <dl className="grid gap-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="font-semibold text-slate-500">服务</dt>
                    <dd className="font-bold text-slate-800">{health.service}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="font-semibold text-slate-500">环境</dt>
                    <dd className="font-bold text-slate-800">{health.environment}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="font-semibold text-slate-500">API 前缀</dt>
                    <dd className="font-bold text-slate-800">{health.api_prefix}</dd>
                  </div>
                </dl>
              ) : (
                <div className="grid gap-3">
                  <p className="text-sm font-medium leading-6 text-slate-600">
                    当前未收到后端健康检查响应。
                  </p>
                  <p className="break-all rounded-lg bg-slate-100 p-3 text-xs font-semibold text-slate-600">
                    {API_BASE_URL}/health
                  </p>
                </div>
              )}

              <Button
                className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
                isLoading={healthQuery.isFetching}
                startContent={<RefreshCcw className="h-4 w-4" aria-hidden="true" />}
                variant="flat"
                onPress={() => void healthQuery.refetch()}
              >
                刷新状态
              </Button>
            </CardBody>
          </Card>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        {readinessItems.map((item) => {
          const Icon = item.icon;
          const configured =
            item.title === "PostgreSQL"
              ? health?.database_configured
              : item.title === "MinIO"
                ? health?.minio_configured
                : item.title === "Redis / RQ"
                  ? health?.redis_configured
                  : health?.worker_contract.worker_token_configured;

          return (
            <Card key={item.title} className="rounded-lg border border-slate-200 shadow-none">
              <CardBody className="gap-4 p-5">
                <div className="flex items-start justify-between gap-4">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-action-soft text-action">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  {configured ? (
                    <StatusPill tone="success">已配置</StatusPill>
                  ) : (
                    <StatusPill tone="warning">待配置</StatusPill>
                  )}
                </div>
                <div>
                  <h3 className="text-base font-black text-ink">{item.title}</h3>
                  <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
                    {item.description}
                  </p>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="rounded-lg border border-slate-200 shadow-none">
          <CardBody className="gap-4 p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-action-soft text-action">
                <Server className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-black text-ink">接口基础封装</h2>
                <p className="text-sm font-medium text-slate-500">
                  TanStack Query 已接入健康检查，业务接口从同一封装扩展。
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="break-all font-mono text-sm font-semibold text-slate-700">
                {API_BASE_URL}
              </p>
            </div>
          </CardBody>
        </Card>

        <Card className="rounded-lg border border-slate-200 shadow-none">
          <CardBody className="gap-4 p-5">
            <h2 className="text-lg font-black text-ink">阶段边界</h2>
            <p className="text-sm font-medium leading-6 text-slate-600">
              当前只完成基础工程框架；项目 CRUD、照片上传、AI 任务、审核和报告在后续阶段分步接入。
            </p>
            <Link
              as={RouterLink}
              className="text-sm font-black text-action"
              to="/capabilities"
            >
              查看预留路由
            </Link>
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
