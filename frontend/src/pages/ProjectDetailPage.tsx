import { Button, Card, CardBody, Divider, Input, Skeleton } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  FileText,
  RefreshCcw,
  Save,
  Send,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";

import {
  deleteFacade,
  projectQueryOptions,
  startDetection,
  updateFacade,
  updateProject
} from "@/api/projects";
import { DetectionConfigSection } from "@/components/project/DetectionConfigSection";
import { FacadePhotoActions } from "@/components/project/FacadePhotoActions";
import { PhotoManagementSection } from "@/components/project/PhotoManagementSection";
import { ProjectLocationMap } from "@/components/project/ProjectLocationMap";
import { StatusPill } from "@/components/StatusPill";
import type {
  Building,
  Facade,
  FacadeUpdatePayload,
  ProjectDetail,
  ProjectStatus,
  ProjectUpdatePayload
} from "@/types/projects";
import {
  formatDateTime,
  formatLocation,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES
} from "@/utils/projectDisplay";

interface ProjectBasicDraft {
  name: string;
  contact_name: string;
  contact_phone: string;
  address: string;
  longitude: string;
  latitude: string;
}

interface BuildingDraft {
  name: string;
  floors: string;
  height: string;
}

interface FacadeDraft {
  name: string;
  area: string;
  floors_range: string;
  description: string;
}

const emptyProjectDraft: ProjectBasicDraft = {
  name: "",
  contact_name: "",
  contact_phone: "",
  address: "",
  longitude: "",
  latitude: ""
};

const emptyBuildingDraft: BuildingDraft = {
  name: "",
  floors: "",
  height: ""
};

const emptyFacadeDraft: FacadeDraft = {
  name: "",
  area: "",
  floors_range: "",
  description: ""
};

function cleanText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function cleanDecimal(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function projectToDraft(project: ProjectDetail): ProjectBasicDraft {
  return {
    name: project.name,
    contact_name: project.contact_name ?? "",
    contact_phone: project.contact_phone ?? "",
    address: project.address ?? "",
    longitude: project.longitude ?? "",
    latitude: project.latitude ?? ""
  };
}

function draftPosition(draft: ProjectBasicDraft) {
  const longitudeText = draft.longitude.trim();
  const latitudeText = draft.latitude.trim();
  if (!longitudeText || !latitudeText) return null;
  const longitude = Number(longitudeText);
  const latitude = Number(latitudeText);
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? { longitude, latitude } : null;
}

function buildingToDraft(building: Building): BuildingDraft {
  return {
    name: building.name,
    floors: building.floors === null ? "" : String(building.floors),
    height: building.height ?? ""
  };
}

function facadeToDraft(facade: Facade): FacadeDraft {
  return {
    name: facade.name,
    area: facade.area ?? "",
    floors_range: facade.floors_range ?? "",
    description: facade.description ?? ""
  };
}

function getPrimaryAction(status: ProjectStatus) {
  switch (status) {
    case "draft":
      return { label: "开始 AI 检测", note: "创建检测任务后，项目会进入 AI 检测中状态，等待 Worker 拉取处理。" };
    case "detecting":
      return { label: "AI检测中，不可点击", note: "算法任务完成前项目保持只读。" };
    case "pending_review":
      return { label: "结果审核中，不可点击", note: "普通用户侧不展示内部审核细节。" };
    case "reviewed":
      return { label: "报告生成中，不可点击", note: "内部审核人员推送后，普通用户可查看最终报告。" };
    case "completed":
      return { label: "查看结果", note: "最终结果已推送，可在线预览并下载 DOCX。" };
    default:
      return { label: "后续阶段接入", note: "当前状态暂无可执行操作。" };
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function ProjectDetailPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const projectQuery = useQuery(projectQueryOptions(id));
  const project = projectQuery.data;

  const [projectDraft, setProjectDraft] = useState<ProjectBasicDraft>(emptyProjectDraft);
  const [buildingDrafts, setBuildingDrafts] = useState<Record<string, BuildingDraft>>({});
  const [facadeDrafts, setFacadeDrafts] = useState<Record<string, FacadeDraft>>({});
  const [formError, setFormError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const isEditable = project?.status === "draft";
  const primaryAction = useMemo(
    () => getPrimaryAction(project?.status ?? "draft"),
    [project?.status]
  );

  const invalidateProject = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["projects", id] })
    ]);
  };

  useEffect(() => {
    if (!project) return;

    setProjectDraft(projectToDraft(project));
    setBuildingDrafts(
      Object.fromEntries(project.buildings.map((building) => [building.id, buildingToDraft(building)]))
    );
    setFacadeDrafts(
      Object.fromEntries(
        project.buildings.flatMap((building) =>
          building.facades.map((facade) => [facade.id, facadeToDraft(facade)])
        )
      )
    );
  }, [project]);

  const updateProjectMutation = useMutation({
    mutationFn: (payload: ProjectUpdatePayload) => updateProject(id, payload),
    onSuccess: invalidateProject
  });

  const updateFacadeMutation = useMutation({
    mutationFn: ({ facadeId, payload }: { facadeId: string; payload: FacadeUpdatePayload }) =>
      updateFacade(facadeId, payload),
    onSuccess: invalidateProject
  });

  const deleteFacadeMutation = useMutation({
    mutationFn: deleteFacade,
    onSuccess: invalidateProject
  });

  const startDetectionMutation = useMutation({
    mutationFn: () => startDetection(id),
    onSuccess: async () => {
      setFormError("");
      setActionMessage("AI 检测任务已创建，模拟 Worker 或正式 Worker 可开始拉取任务。");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["projects", id] }),
        queryClient.invalidateQueries({ queryKey: ["projects", id, "photos"] })
      ]);
    }
  });

  const activeError =
    updateProjectMutation.error ??
    updateFacadeMutation.error ??
    deleteFacadeMutation.error ??
    startDetectionMutation.error;

  const updateProjectField = (field: keyof ProjectBasicDraft, value: string) => {
    setProjectDraft((current) => ({ ...current, [field]: value }));
    setFormError("");
    setActionMessage("");
  };

  const updateProjectPosition = (position: { longitude: number; latitude: number }) => {
    setProjectDraft((current) => ({
      ...current,
      longitude: position.longitude.toFixed(7),
      latitude: position.latitude.toFixed(7)
    }));
    setFormError("");
    setActionMessage("");
  };

  const updateBuildingDraft = (buildingId: string, field: keyof BuildingDraft, value: string) => {
    setBuildingDrafts((current) => ({
      ...current,
      [buildingId]: {
        ...(current[buildingId] ?? emptyBuildingDraft),
        [field]: value
      }
    }));
    setFormError("");
    setActionMessage("");
  };

  const updateFacadeDraft = (facadeId: string, field: keyof FacadeDraft, value: string) => {
    setFacadeDrafts((current) => ({
      ...current,
      [facadeId]: {
        ...(current[facadeId] ?? emptyFacadeDraft),
        [field]: value
      }
    }));
    setFormError("");
    setActionMessage("");
  };

  const saveProject = () => {
    if (!projectDraft.name.trim()) {
      setFormError("请填写项目名称。");
      return;
    }
    const payload: ProjectUpdatePayload = {
      name: projectDraft.name.trim(),
      contact_name: cleanText(projectDraft.contact_name),
      contact_phone: cleanText(projectDraft.contact_phone),
      address: cleanText(projectDraft.address),
      longitude: cleanDecimal(projectDraft.longitude),
      latitude: cleanDecimal(projectDraft.latitude)
    };
    updateProjectMutation.mutate(payload);
  };

  const saveFacade = (facadeId: string) => {
    const draft = facadeDrafts[facadeId];
    if (!draft?.name.trim()) {
      setFormError("请填写立面名称。");
      return;
    }
    updateFacadeMutation.mutate({
      facadeId,
      payload: {
        name: draft.name.trim(),
        area: cleanDecimal(draft.area),
        floors_range: cleanText(draft.floors_range),
        description: cleanText(draft.description)
      }
    });
  };

  const confirmDeleteFacade = (facade: Facade) => {
    const confirmed = window.confirm(`确认删除立面“${facade.name}”？`);
    if (!confirmed) return;
    deleteFacadeMutation.mutate(facade.id);
  };

  const handlePrimaryAction = () => {
    if (project?.status !== "draft") return;
    setActionMessage("");
    startDetectionMutation.mutate();
  };

  if (projectQuery.isLoading) {
    return (
      <div className="grid gap-5">
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  if (projectQuery.isError || !project) {
    return (
      <div className="grid min-h-[calc(100svh-8rem)] place-items-center">
        <Card className="w-full max-w-2xl rounded-lg border border-red-200 shadow-none">
          <CardBody className="gap-4 p-6">
            <h1 className="text-xl font-black text-ink">项目加载失败</h1>
            <p className="text-sm font-bold text-red-700">
              {getErrorMessage(projectQuery.error)}
            </p>
            <Button
              as={RouterLink}
              className="w-fit rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
              to="/projects"
              variant="flat"
            >
              返回列表
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (id) return (
    <ProjectDetailPrototype
      actionMessage={actionMessage}
      activeError={activeError}
      buildingDrafts={buildingDrafts}
      facadeDrafts={facadeDrafts}
      deleteFacadePending={deleteFacadeMutation.isPending}
      formError={formError}
      isEditable={isEditable}
      primaryAction={primaryAction}
      project={project}
      projectDraft={projectDraft}
      projectPosition={draftPosition(projectDraft)}
      projectSaving={updateProjectMutation.isPending}
      startDetectionPending={startDetectionMutation.isPending}
      onDeleteFacade={confirmDeleteFacade}
      onPrimaryAction={handlePrimaryAction}
      onProjectFieldChange={updateProjectField}
      onProjectPositionChange={updateProjectPosition}
      onSaveProject={saveProject}
      onUpdateBuilding={updateBuildingDraft}
      onUpdateFacade={updateFacadeDraft}
    />
  );

  return (
    <div className="grid gap-5 pb-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase text-action">Project Detail</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-black text-ink">{project.name}</h1>
            <StatusPill tone={PROJECT_STATUS_TONES[project.status]}>
              {PROJECT_STATUS_LABELS[project.status]}
            </StatusPill>
          </div>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-7 text-slate-600">
            {formatLocation(project)}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            as={RouterLink}
            className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
            startContent={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
            to="/projects"
            variant="flat"
          >
            返回列表
          </Button>
          <Button
            className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
            isLoading={projectQuery.isFetching}
            startContent={<RefreshCcw className="h-4 w-4" aria-hidden="true" />}
            variant="flat"
            onPress={() => void projectQuery.refetch()}
          >
            刷新
          </Button>
        </div>
      </section>

      {!isEditable ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
          当前项目状态为“{PROJECT_STATUS_LABELS[project.status]}”，基础信息、建筑和立面只读。
        </div>
      ) : null}

      {(formError || activeError) ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {formError || getErrorMessage(activeError)}
        </div>
      ) : null}

      {actionMessage ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          {actionMessage}
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-4">
        <MetricBlock label="项目编号" value={project.project_no} />
        <MetricBlock label="建筑数量" value={`${project.building_count}`} />
        <MetricBlock label="照片数量" value={`${project.photo_count}`} />
        <MetricBlock label="更新时间" value={formatDateTime(project.updated_at)} />
      </section>

      <Card className="rounded-lg border border-slate-200 shadow-none">
        <CardBody className="gap-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-ink">项目基础信息</h2>
              <p className="mt-1 text-xs font-bold text-slate-500">
                只有待检测项目可编辑，保存后列表更新时间同步刷新。
              </p>
            </div>
            <Button
              className="rounded-lg font-bold"
              color="primary"
              isDisabled={!isEditable}
              isLoading={updateProjectMutation.isPending}
              startContent={<Save className="h-4 w-4" aria-hidden="true" />}
              onPress={saveProject}
            >
              保存基础信息
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Input
              isRequired
              isDisabled={!isEditable}
              classNames={{ inputWrapper: "rounded-lg shadow-none" }}
              className="lg:col-span-2"
              label="项目名称"
              value={projectDraft.name}
              onValueChange={(value) => updateProjectField("name", value)}
            />
            <Input
              isDisabled={!isEditable}
              classNames={{ inputWrapper: "rounded-lg shadow-none" }}
              label="联系人"
              value={projectDraft.contact_name}
              onValueChange={(value) => updateProjectField("contact_name", value)}
            />
            <Input
              isDisabled={!isEditable}
              classNames={{ inputWrapper: "rounded-lg shadow-none" }}
              label="联系电话"
              value={projectDraft.contact_phone}
              onValueChange={(value) => updateProjectField("contact_phone", value)}
            />
            <Input
              isDisabled={!isEditable}
              classNames={{ inputWrapper: "rounded-lg shadow-none" }}
              className="lg:col-span-2"
              label="项目位置"
              value={projectDraft.address}
              onValueChange={(value) => updateProjectField("address", value)}
            />
          </div>
        </CardBody>
      </Card>

      <Card className="rounded-lg border border-slate-200 shadow-none">
        <CardBody className="gap-5 p-5">
          <div>
            <h2 className="text-lg font-black text-ink">建筑与立面信息</h2>
            <p className="mt-1 text-xs font-bold text-slate-500">
              本阶段维护建筑和立面基础信息；立面不包含朝向字段。
            </p>
          </div>

          <div className="grid gap-4">
            {project.buildings.length ? (
              project.buildings.map((building, index) => {
                const draft = buildingDrafts[building.id] ?? buildingToDraft(building);
                return (
                  <div key={building.id} className="rounded-lg border border-slate-200 bg-slate-50">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                      <div className="inline-flex items-center gap-2">
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-action-soft text-action">
                          <Building2 className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <strong className="text-sm text-ink">建筑 {index + 1}</strong>
                      </div>
                    </div>

                    <div className="grid gap-4 p-4">
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_140px_150px]">
                        <Input
                          isRequired
                          isDisabled={!isEditable}
                          classNames={{ inputWrapper: "rounded-lg shadow-none" }}
                          label="建筑名称"
                          value={draft.name}
                          onValueChange={(value) => updateBuildingDraft(building.id, "name", value)}
                        />
                        <Input
                          isDisabled={!isEditable}
                          classNames={{ inputWrapper: "rounded-lg shadow-none" }}
                          label="楼层数"
                          type="number"
                          value={draft.floors}
                          onValueChange={(value) => updateBuildingDraft(building.id, "floors", value)}
                        />
                        <Input
                          isDisabled={!isEditable}
                          classNames={{ inputWrapper: "rounded-lg shadow-none" }}
                          label="高度（米）"
                          type="number"
                          value={draft.height}
                          onValueChange={(value) => updateBuildingDraft(building.id, "height", value)}
                        />
                      </div>

                      <Divider />

                      <div className="grid gap-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <strong className="text-sm text-slate-700">检测立面</strong>
                          <span className="text-xs font-bold text-slate-500">
                            {building.facades.length} 个立面
                          </span>
                        </div>

                        {building.facades.map((facade, facadeIndex) => {
                          const facadeDraft = facadeDrafts[facade.id] ?? facadeToDraft(facade);
                          return (
                            <div key={facade.id} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 lg:grid-cols-[minmax(0,1fr)_140px_160px_minmax(0,1fr)_auto]">
                              <Input
                                isRequired
                                isDisabled={!isEditable}
                                classNames={{ inputWrapper: "rounded-lg shadow-none" }}
                                label={`立面 ${facadeIndex + 1}`}
                                value={facadeDraft.name}
                                onValueChange={(value) =>
                                  updateFacadeDraft(facade.id, "name", value)
                                }
                              />
                              <Input
                                isDisabled={!isEditable}
                                classNames={{ inputWrapper: "rounded-lg shadow-none" }}
                                label="面积（㎡）"
                                type="number"
                                value={facadeDraft.area}
                                onValueChange={(value) =>
                                  updateFacadeDraft(facade.id, "area", value)
                                }
                              />
                              <Input
                                isDisabled={!isEditable}
                                classNames={{ inputWrapper: "rounded-lg shadow-none" }}
                                label="楼层范围"
                                value={facadeDraft.floors_range}
                                onValueChange={(value) =>
                                  updateFacadeDraft(facade.id, "floors_range", value)
                                }
                              />
                              <Input
                                isDisabled={!isEditable}
                                classNames={{ inputWrapper: "rounded-lg shadow-none" }}
                                label="说明"
                                value={facadeDraft.description}
                                onValueChange={(value) =>
                                  updateFacadeDraft(facade.id, "description", value)
                                }
                              />
                              <div className="flex self-end gap-2">
                                <Button
                                  isIconOnly
                                  aria-label="保存立面"
                                  className="rounded-lg border border-slate-300 bg-white text-slate-700 shadow-none"
                                  isDisabled={!isEditable}
                                  isLoading={updateFacadeMutation.isPending}
                                  size="sm"
                                  variant="flat"
                                  onPress={() => saveFacade(facade.id)}
                                >
                                  <Save className="h-4 w-4" aria-hidden="true" />
                                </Button>
                                <Button
                                  isIconOnly
                                  aria-label="删除立面"
                                  className="rounded-lg border border-red-200 bg-white text-red-600 shadow-none"
                                  isDisabled={!isEditable}
                                  isLoading={deleteFacadeMutation.isPending}
                                  size="sm"
                                  variant="flat"
                                  onPress={() => confirmDeleteFacade(facade)}
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}

                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center">
                <p className="font-bold text-slate-500">暂无建筑信息。</p>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      <PhotoManagementSection project={project} isEditable={isEditable} />

      <DetectionConfigSection project={project} isEditable={isEditable} />

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-ink">当前项目状态</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              {primaryAction.note}
            </p>
          </div>
          {project.status === "completed" && project.current_report_id ? (
            <Button
              as={RouterLink}
              className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
              startContent={<FileText className="h-4 w-4" aria-hidden="true" />}
              to={`/reports/${project.current_report_id}`}
              variant="flat"
            >
              {primaryAction.label}
            </Button>
          ) : (
            <Button
              className="rounded-lg font-bold"
              color="primary"
              isDisabled={project.status !== "draft"}
              isLoading={startDetectionMutation.isPending}
              startContent={<Send className="h-4 w-4" aria-hidden="true" />}
              onPress={handlePrimaryAction}
            >
              {primaryAction.label}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

function ProjectDetailPrototype({
  project,
  isEditable,
  projectDraft,
  projectPosition,
  buildingDrafts,
  facadeDrafts,
  formError,
  activeError,
  actionMessage,
  primaryAction,
  projectSaving,
  deleteFacadePending,
  startDetectionPending,
  onProjectFieldChange,
  onProjectPositionChange,
  onSaveProject,
  onUpdateBuilding,
  onUpdateFacade,
  onDeleteFacade,
  onPrimaryAction
}: {
  project: ProjectDetail;
  isEditable: boolean;
  projectDraft: ProjectBasicDraft;
  projectPosition: { longitude: number; latitude: number } | null;
  buildingDrafts: Record<string, BuildingDraft>;
  facadeDrafts: Record<string, FacadeDraft>;
  formError: string;
  activeError: unknown;
  actionMessage: string;
  primaryAction: { label: string; note: string };
  projectSaving: boolean;
  deleteFacadePending: boolean;
  startDetectionPending: boolean;
  onProjectFieldChange: (field: keyof ProjectBasicDraft, value: string) => void;
  onProjectPositionChange: (position: { longitude: number; latitude: number }) => void;
  onSaveProject: () => void;
  onUpdateBuilding: (id: string, field: keyof BuildingDraft, value: string) => void;
  onUpdateFacade: (facadeId: string, field: keyof FacadeDraft, value: string) => void;
  onDeleteFacade: (facade: Facade) => void;
  onPrimaryAction: () => void;
}) {
  const disabled = !isEditable;

  return (
    <div className="create-workspace project-detail-prototype" id="project-detail-workspace">
      {!isEditable ? <p className="detail-feedback warning">当前项目为“{PROJECT_STATUS_LABELS[project.status]}”，信息仅供查看。</p> : null}
      {formError || activeError ? <p className="detail-feedback error">{formError || getErrorMessage(activeError)}</p> : null}
      {actionMessage ? <p className="detail-feedback success">{actionMessage}</p> : null}

      <section className="create-section basic-section" aria-labelledby="basic-title">
        <div className="create-section-heading"><span className="section-index">01</span><div><h2 id="basic-title">项目基础信息</h2></div></div>
        <div className="basic-layout">
          <div className="project-fields">
            <PrototypeField label="项目编号"><input disabled value={project.project_no} /></PrototypeField>
            <PrototypeField label="项目状态"><input disabled value={PROJECT_STATUS_LABELS[project.status]} /></PrototypeField>
            <PrototypeField label="项目名称" required className="full-field"><input disabled={disabled} value={projectDraft.name} onChange={(event) => onProjectFieldChange("name", event.target.value)} /></PrototypeField>
            <PrototypeField label="联系人" required><input disabled={disabled} value={projectDraft.contact_name} onChange={(event) => onProjectFieldChange("contact_name", event.target.value)} /></PrototypeField>
            <PrototypeField label="联系电话" required><input disabled={disabled} value={projectDraft.contact_phone} onChange={(event) => onProjectFieldChange("contact_phone", event.target.value)} /></PrototypeField>
            <PrototypeField label="项目位置" className="full-field"><input disabled={disabled} value={projectDraft.address} onChange={(event) => onProjectFieldChange("address", event.target.value)} /></PrototypeField>
          </div>
          <ProjectLocationMap
            address={projectDraft.address}
            initialPosition={projectPosition}
            isEditable={isEditable}
            onPositionChange={onProjectPositionChange}
          />
        </div>
      </section>

      <section className="create-section buildings-section" aria-labelledby="buildings-title">
        <div className="create-section-heading buildings-heading"><span className="section-index">02</span><div><h2 id="buildings-title">建筑与检测立面</h2></div></div>
        <div className="building-list">
          {project.buildings.map((building, buildingIndex) => {
            const draft = buildingDrafts[building.id] ?? buildingToDraft(building);
            return (
              <article key={building.id} className="building-card">
                <header className="building-card-header">
                  <div className="building-toggle">
                    <span className="building-number">建筑 {String(buildingIndex + 1).padStart(2, "0")}</span>
                    <span className="building-heading-copy"><strong>{draft.name || "未命名建筑"}</strong></span>
                  </div>
                </header>
                <div className="building-card-body">
                  <div className="building-fields">
                    <PrototypeField label="建筑名称" required>
                      <input disabled={disabled} value={draft.name} onChange={(event) => onUpdateBuilding(building.id, "name", event.target.value)} />
                    </PrototypeField>
                    <PrototypeField label="建筑层数">
                      <span className="unit-control">
                        <input disabled={disabled} inputMode="numeric" value={draft.floors} onChange={(event) => onUpdateBuilding(building.id, "floors", event.target.value)} />
                        <em>层</em>
                      </span>
                    </PrototypeField>
                    <PrototypeField label="建筑高度">
                      <span className="unit-control">
                        <input disabled={disabled} inputMode="decimal" value={draft.height} onChange={(event) => onUpdateBuilding(building.id, "height", event.target.value)} />
                        <em>m</em>
                      </span>
                    </PrototypeField>
                  </div>
                  <div className="facade-editor detail-facade-editor">
                    <div className="facade-editor-heading"><div><h3>检测立面配置</h3></div></div>
                    <div className="facade-table-head detail-facade-head"><span>序号</span><span>立面名称</span><span>照片</span><span>照片管理</span><span>编辑</span></div>
                    <div className="facade-list">
                      {building.facades.map((facade, facadeIndex) => {
                        const facadeDraft = facadeDrafts[facade.id] ?? facadeToDraft(facade);
                        return (
                          <div key={facade.id} className="facade-row detail-facade-row">
                            <span className="facade-index">{String(facadeIndex + 1).padStart(2, "0")}</span>
                            <label>
                              <span className="sr-only">立面名称</span>
                              <input disabled={disabled} value={facadeDraft.name} onChange={(event) => onUpdateFacade(facade.id, "name", event.target.value)} />
                            </label>
                            <FacadePhotoActions building={building} facade={facade} isEditable={isEditable} project={project} />
                            <button aria-label="删除立面" className="remove-facade-button" disabled={disabled || deleteFacadePending} type="button" onClick={() => onDeleteFacade(facade)}><Trash2 aria-hidden="true" /></button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="create-section ai-config-section"><div className="create-section-heading"><span className="section-index">03</span><div><h2>AI检测配置</h2></div></div><div className="detail-integrated-module"><DetectionConfigSection project={project} isEditable={isEditable} /></div></section>

      <div className="create-action-bar detail-action-bar"><div className="create-summary"><Building2 aria-hidden="true" />{project.project_no} · {project.photo_count} 张照片</div><div className="detail-view-actions"><RouterLink className="button secondary" to="/projects"><ArrowLeft aria-hidden="true" />返回列表</RouterLink><button className="button secondary" disabled={disabled || projectSaving} type="button" onClick={onSaveProject}><Save aria-hidden="true" />{projectSaving ? "正在保存" : "保存修改"}</button>{project.status === "completed" && project.current_report_id ? <RouterLink className="button primary" to={`/reports/${project.current_report_id}`}><FileText aria-hidden="true" />查看结果</RouterLink> : <button className="button primary start-ai-detection-button" disabled={project.status !== "draft" || startDetectionPending} type="button" onClick={onPrimaryAction}><Send aria-hidden="true" />{startDetectionPending ? "正在创建" : primaryAction.label}</button>}</div></div>
    </div>
  );
}

function PrototypeField({ label, required, className = "", children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return <label className={`form-field ${className}`}><span>{label}{required ? <b>*</b> : null}</span>{children}</label>;
}

function MetricBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-black uppercase text-slate-500">{label}</p>
      <strong className="mt-2 block truncate text-base font-black text-ink">{value}</strong>
    </div>
  );
}
