import { Button, Card, CardBody, Divider, Skeleton } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Camera, Eye, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";

import { deleteProject, projectsQueryOptions } from "@/api/projects";
import { StatusPill } from "@/components/StatusPill";
import {
  formatDateTime,
  formatLocation,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES
} from "@/utils/projectDisplay";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function ProjectListPage() {
  const queryClient = useQueryClient();
  const projectsQuery = useQuery(projectsQueryOptions);
  const projects = projectsQuery.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    }
  });

  const handleDelete = (projectId: string, projectName: string) => {
    const confirmed = window.confirm(`确认删除项目“${projectName}”？此操作会软删除项目、建筑和立面。`);
    if (!confirmed) return;
    deleteMutation.mutate(projectId);
  };

  return (
    <div className="grid gap-5">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase text-action">Project Management</p>
          <h1 className="mt-2 text-3xl font-black text-ink">项目管理</h1>
          <p className="mt-3 max-w-2xl text-sm font-semibold leading-7 text-slate-600">
            查看外墙巡检项目，进入详情维护建筑与检测立面。
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
            isLoading={projectsQuery.isFetching}
            startContent={<RefreshCcw className="h-4 w-4" aria-hidden="true" />}
            variant="flat"
            onPress={() => void projectsQuery.refetch()}
          >
            刷新
          </Button>
          <Button
            as={RouterLink}
            className="rounded-lg font-bold"
            color="primary"
            startContent={<Plus className="h-4 w-4" aria-hidden="true" />}
            to="/projects/new"
          >
            新建项目
          </Button>
        </div>
      </section>

      {deleteMutation.isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {getErrorMessage(deleteMutation.error)}
        </div>
      ) : null}

      <Card className="rounded-lg border border-slate-200 shadow-none">
        <CardBody className="gap-0 p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <h2 className="text-lg font-black text-ink">项目列表</h2>
              <p className="mt-1 text-xs font-bold text-slate-500">
                共 {projects.length} 个未删除项目
              </p>
            </div>
          </div>
          <Divider />

          {projectsQuery.isLoading ? (
            <div className="grid gap-3 p-5">
              <Skeleton className="h-12 rounded-lg" />
              <Skeleton className="h-12 rounded-lg" />
              <Skeleton className="h-12 rounded-lg" />
            </div>
          ) : projectsQuery.isError ? (
            <div className="p-5">
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                {getErrorMessage(projectsQuery.error)}
              </div>
            </div>
          ) : projects.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-[1040px] w-full border-separate border-spacing-0 text-left text-sm">
                <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                  <tr>
                    <th className="border-b border-slate-200 px-5 py-3">项目名称</th>
                    <th className="border-b border-slate-200 px-5 py-3">项目位置</th>
                    <th className="border-b border-slate-200 px-5 py-3">委托单位</th>
                    <th className="border-b border-slate-200 px-5 py-3">建筑</th>
                    <th className="border-b border-slate-200 px-5 py-3">照片</th>
                    <th className="border-b border-slate-200 px-5 py-3">状态</th>
                    <th className="border-b border-slate-200 px-5 py-3">创建时间</th>
                    <th className="border-b border-slate-200 px-5 py-3">更新时间</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.id} className="align-middle hover:bg-slate-50">
                      <td className="border-b border-slate-100 px-5 py-4">
                        <div className="min-w-0">
                          <p className="truncate font-black text-ink">{project.name}</p>
                          <p className="mt-1 font-mono text-xs font-semibold text-slate-500">
                            {project.project_no}
                          </p>
                        </div>
                      </td>
                      <td className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-600">
                        {formatLocation(project)}
                      </td>
                      <td className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-600">
                        {project.client_name || "-"}
                      </td>
                      <td className="border-b border-slate-100 px-5 py-4">
                        <span className="inline-flex items-center gap-2 font-black text-slate-700">
                          <Building2 className="h-4 w-4 text-action" aria-hidden="true" />
                          {project.building_count}
                        </span>
                      </td>
                      <td className="border-b border-slate-100 px-5 py-4">
                        <span className="inline-flex items-center gap-2 font-black text-slate-700">
                          <Camera className="h-4 w-4 text-action" aria-hidden="true" />
                          {project.photo_count}
                        </span>
                      </td>
                      <td className="border-b border-slate-100 px-5 py-4">
                        <StatusPill tone={PROJECT_STATUS_TONES[project.status]}>
                          {PROJECT_STATUS_LABELS[project.status]}
                        </StatusPill>
                      </td>
                      <td className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-600">
                        {formatDateTime(project.created_at)}
                      </td>
                      <td className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-600">
                        {formatDateTime(project.updated_at)}
                      </td>
                      <td className="border-b border-slate-100 px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <Button
                            as={RouterLink}
                            className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
                            size="sm"
                            startContent={<Eye className="h-4 w-4" aria-hidden="true" />}
                            to={`/projects/${project.id}`}
                            variant="flat"
                          >
                            详情
                          </Button>
                          <Button
                            isIconOnly
                            aria-label="删除项目"
                            className="rounded-lg border border-red-200 bg-white text-red-600 shadow-none disabled:opacity-40"
                            isDisabled={project.status !== "draft" || deleteMutation.isPending}
                            size="sm"
                            variant="flat"
                            onPress={() => handleDelete(project.id, project.name)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid min-h-72 place-items-center p-6 text-center">
              <div>
                <FolderEmptyIcon />
                <h2 className="mt-4 text-xl font-black text-ink">暂无项目</h2>
                <p className="mt-2 text-sm font-semibold text-slate-500">
                  创建第一个项目后，可以进入详情维护建筑和检测立面。
                </p>
                <Button
                  as={RouterLink}
                  className="mt-5 rounded-lg font-bold"
                  color="primary"
                  startContent={<Plus className="h-4 w-4" aria-hidden="true" />}
                  to="/projects/new"
                >
                  新建项目
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function FolderEmptyIcon() {
  return (
    <span className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-action-soft text-action">
      <Building2 className="h-6 w-6" aria-hidden="true" />
    </span>
  );
}
