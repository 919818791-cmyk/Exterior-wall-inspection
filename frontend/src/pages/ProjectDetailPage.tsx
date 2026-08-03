import {
  Card,
  CardBody,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Skeleton
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  FileText,
  Images,
  ScanLine,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink, useLocation, useNavigate, useParams } from "react-router-dom";

import {
  deleteProject,
  projectQueryOptions,
  projectPhotosQueryOptions,
  startDetection,
  updateProject
} from "@/api/projects";
import { ProjectPhotoActions } from "@/components/project/ProjectPhotoActions";
import { ProjectWorkbenchShell } from "@/components/project/ProjectWorkbenchShell";
import type {
  Photo,
  ProjectDetail,
  ProjectStatus,
  ProjectUpdatePayload,
  StartDetectionPayload
} from "@/types/projects";
import { PROJECT_STATUS_LABELS } from "@/utils/projectDisplay";

interface ProjectBasicDraft {
  name: string;
  address: string;
}

interface ProjectAutoSaveRequest {
  projectId: string;
  payload: ProjectUpdatePayload;
  signature: string;
}

const PROJECT_AUTO_SAVE_DELAY_MS = 600;

const emptyProjectDraft: ProjectBasicDraft = {
  name: "",
  address: ""
};

function cleanText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function projectToDraft(project: ProjectDetail): ProjectBasicDraft {
  return {
    name: project.name,
    address: project.address ?? ""
  };
}

function getPrimaryAction(status: ProjectStatus) {
  switch (status) {
    case "draft":
      return { label: "开始 AI 检测", note: "系统会统一检测预检通过的照片，并送入审核工作台。" };
    case "detecting":
      return { label: "AI检测中，不可点击", note: "算法任务完成前项目保持只读。" };
    case "pending_review":
      return { label: "结果审核中，不可点击", note: "普通用户侧不展示内部审核细节。" };
    case "reviewed":
      return { label: "审核完成", note: "审核结果已固化，等待最终报告推送。" };
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
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projectQuery = useQuery(projectQueryOptions(id));
  const projectPhotosQuery = useQuery(projectPhotosQueryOptions(id));
  const project = projectQuery.data;
  const projectCreationState = location.state as {
    openDetectionModal?: boolean;
    projectCreationNotice?: string;
  } | null;
  const projectCreationNotice = projectCreationState?.projectCreationNotice ?? "";

  const [projectDraft, setProjectDraft] = useState<ProjectBasicDraft>(emptyProjectDraft);
  const [formError, setFormError] = useState("");
  const [detectionModalOpen, setDetectionModalOpen] = useState(
    projectCreationState?.openDetectionModal ?? false
  );
  const draftProjectIdRef = useRef("");
  const queuedAutoSaveRef = useRef<ProjectAutoSaveRequest | null>(null);
  const activeAutoSaveSignatureRef = useRef("");
  const failedAutoSaveSignatureRef = useRef("");
  const autoSaveQueueRunningRef = useRef(false);

  const isEditable = project?.status === "draft";
  const primaryAction = useMemo(
    () => getPrimaryAction(project?.status ?? "draft"),
    [project?.status]
  );

  useEffect(() => {
    if (!project) return;
    if (draftProjectIdRef.current === project.id) return;

    draftProjectIdRef.current = project.id;
    queuedAutoSaveRef.current = null;
    activeAutoSaveSignatureRef.current = "";
    failedAutoSaveSignatureRef.current = "";
    setProjectDraft(projectToDraft(project));
  }, [project]);

  const updateProjectMutation = useMutation({
    mutationFn: ({
      projectId,
      payload
    }: Pick<ProjectAutoSaveRequest, "projectId" | "payload">) =>
      updateProject(projectId, payload),
    onSuccess: async (updatedProject, request) => {
      queryClient.setQueryData(["projects", request.projectId], updatedProject);
      if (draftProjectIdRef.current === request.projectId) {
        setProjectDraft((current) => ({
          ...current,
          name: cleanText(current.name) === request.payload.name
            ? updatedProject.name
            : current.name,
          address: cleanText(current.address) === request.payload.address
            ? updatedProject.address ?? ""
            : current.address
        }));
      }
      await queryClient.invalidateQueries({ queryKey: ["projects"], exact: true });
    }
  });

  const deleteProjectMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: async (_, projectId) => {
      await queryClient.invalidateQueries({ queryKey: ["projects"], exact: true });
      queryClient.removeQueries({ queryKey: ["projects", projectId] });
      navigate("/projects", { replace: true });
    },
    onError: (error) => setFormError(getErrorMessage(error))
  });

  const runAutoSaveQueue = async () => {
    if (autoSaveQueueRunningRef.current) return;

    autoSaveQueueRunningRef.current = true;
    try {
      while (queuedAutoSaveRef.current) {
        const request = queuedAutoSaveRef.current;
        queuedAutoSaveRef.current = null;
        activeAutoSaveSignatureRef.current = request.signature;
        failedAutoSaveSignatureRef.current = "";

        try {
          await updateProjectMutation.mutateAsync({
            projectId: request.projectId,
            payload: request.payload
          });
        } catch {
          failedAutoSaveSignatureRef.current = request.signature;
        } finally {
          activeAutoSaveSignatureRef.current = "";
        }
      }
    } finally {
      autoSaveQueueRunningRef.current = false;
    }
  };

  const queueProjectAutoSave = (draft: ProjectBasicDraft) => {
    if (!project || !isEditable || draftProjectIdRef.current !== project.id) return;

    const payload: ProjectUpdatePayload = {
      name: cleanText(draft.name),
      address: cleanText(draft.address)
    };
    const signature = JSON.stringify([project.id, payload.name, payload.address]);
    const matchesPersistedProject =
      payload.name === cleanText(project.name)
      && payload.address === cleanText(project.address ?? "");

    if (
      (matchesPersistedProject
        && !activeAutoSaveSignatureRef.current)
      || activeAutoSaveSignatureRef.current === signature
      || queuedAutoSaveRef.current?.signature === signature
      || failedAutoSaveSignatureRef.current === signature
    ) return;

    queuedAutoSaveRef.current = {
      projectId: project.id,
      payload,
      signature
    };
    void runAutoSaveQueue();
  };

  useEffect(() => {
    if (!project || !isEditable || draftProjectIdRef.current !== project.id) return;

    const timer = window.setTimeout(() => {
      queueProjectAutoSave(projectDraft);
    }, PROJECT_AUTO_SAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [
    isEditable,
    project?.address,
    project?.id,
    project?.name,
    projectDraft.address,
    projectDraft.name
  ]);

  const startDetectionMutation = useMutation({
    mutationFn: (payload: StartDetectionPayload) => startDetection(id, payload),
    onSuccess: async () => {
      setFormError("");
      setDetectionModalOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["projects", id] }),
        queryClient.invalidateQueries({ queryKey: ["projects", id, "photos"] })
      ]);
    }
  });

  const activeError =
    updateProjectMutation.error ??
    startDetectionMutation.error;

  const updateProjectField = (field: keyof ProjectBasicDraft, value: string) => {
    if (updateProjectMutation.isError) {
      failedAutoSaveSignatureRef.current = "";
      updateProjectMutation.reset();
    }
    setProjectDraft((current) => ({ ...current, [field]: value }));
    setFormError("");
  };

  const handlePrimaryAction = () => {
    if (project?.status !== "draft") return;
    setDetectionModalOpen(true);
  };

  const handleDeleteProject = () => {
    if (!project || project.status !== "draft") return;
    if (!window.confirm(`确认删除项目“${project.name}”？此操作会软删除项目及其照片。`)) return;

    queuedAutoSaveRef.current = null;
    setFormError("");
    deleteProjectMutation.mutate(project.id);
  };

  if (projectQuery.isLoading) {
    return (
      <ProjectWorkbenchShell actionLabel="返回" hideHeader>
        <div className="create-workspace grid gap-5">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-96 rounded-lg" />
        </div>
      </ProjectWorkbenchShell>
    );
  }

  if (projectQuery.isError || !project) {
    return (
      <ProjectWorkbenchShell actionLabel="返回" hideHeader>
        <div className="create-workspace grid min-h-[calc(100svh-12rem)] place-items-center">
          <Card className="w-full max-w-2xl rounded-lg border border-red-200 shadow-none">
            <CardBody className="gap-4 p-6">
              <h2 className="text-xl font-black text-ink">项目加载失败</h2>
              <p className="text-sm font-bold text-red-700">
                {getErrorMessage(projectQuery.error)}
              </p>
              <RouterLink className="button secondary report-back-button w-fit" to="/projects">
                <ArrowLeft aria-hidden="true" />返回
              </RouterLink>
            </CardBody>
          </Card>
        </div>
      </ProjectWorkbenchShell>
    );
  }

  return (
    <ProjectWorkbenchShell actionLabel="返回" hideHeader>
      <ProjectDetailPrototype
        activeError={activeError}
        deleteProjectPending={deleteProjectMutation.isPending}
        formError={formError}
        isEditable={isEditable}
        primaryAction={primaryAction}
        project={project}
        projectCreationNotice={projectCreationNotice}
        projectDraft={projectDraft}
        startDetectionPending={startDetectionMutation.isPending}
        detectionModalOpen={detectionModalOpen}
        photos={projectPhotosQuery.data ?? []}
        updateProjectPending={updateProjectMutation.isPending}
        onDeleteProject={handleDeleteProject}
        onPrimaryAction={handlePrimaryAction}
        onDetectionModalOpenChange={setDetectionModalOpen}
        onStartDetection={(payload) => startDetectionMutation.mutate(payload)}
        onProjectFieldChange={updateProjectField}
        onProjectFieldBlur={() => queueProjectAutoSave(projectDraft)}
      />
    </ProjectWorkbenchShell>
  );

}

function ProjectDetailPrototype({
  project,
  isEditable,
  projectDraft,
  formError,
  activeError,
  deleteProjectPending,
  primaryAction,
  projectCreationNotice,
  startDetectionPending,
  detectionModalOpen,
  photos,
  updateProjectPending,
  onDeleteProject,
  onProjectFieldChange,
  onProjectFieldBlur,
  onPrimaryAction,
  onDetectionModalOpenChange,
  onStartDetection
}: {
  project: ProjectDetail;
  isEditable: boolean;
  projectDraft: ProjectBasicDraft;
  formError: string;
  activeError: unknown;
  deleteProjectPending: boolean;
  primaryAction: { label: string; note: string };
  projectCreationNotice: string;
  startDetectionPending: boolean;
  detectionModalOpen: boolean;
  photos: Photo[];
  updateProjectPending: boolean;
  onDeleteProject: () => void;
  onProjectFieldChange: (field: keyof ProjectBasicDraft, value: string) => void;
  onProjectFieldBlur: () => void;
  onPrimaryAction: () => void;
  onDetectionModalOpenChange: (isOpen: boolean) => void;
  onStartDetection: (payload: StartDetectionPayload) => void;
}) {
  return (
    <div className="create-workspace project-detail-prototype" id="project-detail-workspace">
      <section className="project-editor-panel" aria-label={`${project.name}项目详情`}>
        {formError || activeError ? <p className="detail-feedback error">{formError || getErrorMessage(activeError)}</p> : null}
        {projectCreationNotice ? <p className="detail-feedback warning">{projectCreationNotice}</p> : null}

        <div className="project-editor-block project-fields project-editor-basic-fields">
          <PrototypeField label="项目编号"><input readOnly value={project.project_no} /></PrototypeField>
          <PrototypeField label="项目状态"><input readOnly value={PROJECT_STATUS_LABELS[project.status]} /></PrototypeField>
          <PrototypeField label="项目名称"><input disabled={!isEditable} value={projectDraft.name} placeholder="可不填，系统将自动生成" onBlur={onProjectFieldBlur} onChange={(event) => onProjectFieldChange("name", event.target.value)} /></PrototypeField>
          <PrototypeField label="项目位置"><input disabled={!isEditable} value={projectDraft.address} onBlur={onProjectFieldBlur} onChange={(event) => onProjectFieldChange("address", event.target.value)} /></PrototypeField>
        </div>

        <div className="project-editor-block project-editor-photo-block">
          <section className="project-photo-workspace" aria-labelledby="project-photo-title">
            <ProjectPhotoActions isEditable={isEditable} project={project} />
          </section>
        </div>

        <div className="create-action-bar detail-action-bar">
          <div className="detail-view-actions">
            <RouterLink className="button secondary report-back-button project-detail-back-button" to="/projects">
              <ArrowLeft aria-hidden="true" />返回
            </RouterLink>
            {project.status === "draft" ? (
              <button
                className="button secondary project-detail-delete-button"
                disabled={deleteProjectPending || updateProjectPending}
                type="button"
                onClick={onDeleteProject}
              >
                <Trash2 aria-hidden="true" />
                {deleteProjectPending ? "删除中…" : "删除"}
              </button>
            ) : null}
            {project.status === "completed" && project.current_report_id
              ? <RouterLink className="button primary" to={`/reports/${project.current_report_id}`}><FileText aria-hidden="true" />查看结果</RouterLink>
              : <button className="button primary start-ai-detection-button" disabled={project.status !== "draft" || startDetectionPending} type="button" onClick={onPrimaryAction}><Send aria-hidden="true" />{startDetectionPending ? "正在创建" : primaryAction.label}</button>}
          </div>
        </div>
      </section>
      <StartDetectionModal
        error={activeError}
        isOpen={detectionModalOpen}
        isPending={startDetectionPending}
        photos={photos}
        onOpenChange={onDetectionModalOpenChange}
        onSubmit={onStartDetection}
      />
    </div>
  );
}

const DETECTION_TYPE_OPTIONS: Array<{
  value: "crack" | "spalling" | "hollow";
  label: string;
  description: string;
}> = [
  { value: "crack", label: "裂缝", description: "分析可见光照片中的线状开裂" },
  { value: "spalling", label: "剥落", description: "分析可见光照片中的面状材料缺失" },
  { value: "hollow", label: "空鼓", description: "仅分析热成像照片中的疑似空鼓" }
];

function StartDetectionModal({
  error,
  isOpen,
  isPending,
  photos,
  onOpenChange,
  onSubmit
}: {
  error: unknown;
  isOpen: boolean;
  isPending: boolean;
  photos: Photo[];
  onOpenChange: (isOpen: boolean) => void;
  onSubmit: (payload: StartDetectionPayload) => void;
}) {
  const [modelTypes, setModelTypes] = useState<Array<"crack" | "spalling" | "hollow">>([
    "crack"
  ]);
  const [localError, setLocalError] = useState("");
  const qualifiedPhotos = useMemo(
    () => photos.filter((photo) => photo.precheck_status === "passed"),
    [photos]
  );
  const thermalPhotoCount = qualifiedPhotos.filter(
    (photo) => photo.photo_type === "thermal"
  ).length;
  const visiblePhotoCount = qualifiedPhotos.length - thermalPhotoCount;
  const modelSelectionWarning =
    thermalPhotoCount > 0
    && visiblePhotoCount === 0
    && modelTypes.some((model) => model === "crack" || model === "spalling")
      ? "当前缺少可见光照片，裂缝和剥落检测不会执行。"
      : "";

  useEffect(() => {
    if (!isOpen) return;
    setModelTypes(
      thermalPhotoCount > 0
        ? visiblePhotoCount > 0
          ? ["crack", "hollow"]
          : ["hollow"]
        : ["crack"]
    );
    setLocalError("");
  }, [isOpen, thermalPhotoCount, visiblePhotoCount]);

  const toggleModel = (model: "crack" | "spalling" | "hollow") => {
    setModelTypes((current) => current.includes(model)
      ? current.filter((value) => value !== model)
      : [...current, model]);
    setLocalError("");
  };

  const submit = () => {
    if (!qualifiedPhotos.length) {
      setLocalError("当前没有预检通过的照片，请先上传合格照片并等待预检完成。");
      return;
    }
    if (!modelTypes.length) {
      setLocalError("请至少勾选一种检测类型。");
      return;
    }
    if (thermalPhotoCount && !modelTypes.includes("hollow")) {
      setLocalError("热成像图片只执行空鼓检测，请勾选空鼓或移除热成像图片。");
      return;
    }
    if (
      visiblePhotoCount
      && !modelTypes.some((model) => model === "crack" || model === "spalling")
    ) {
      setLocalError("可见光图片只执行裂缝或剥落检测，请至少勾选其中一项或移除可见光图片。");
      return;
    }
    onSubmit({ model_types: modelTypes });
  };

  return (
    <Modal
      classNames={{
        backdrop: "start-detection-modal-backdrop",
        base: "start-detection-modal-content",
        wrapper: "start-detection-modal-wrapper"
      }}
      hideCloseButton
      isDismissable={!isPending}
      isKeyboardDismissDisabled={isPending}
      isOpen={isOpen}
      placement="center"
      scrollBehavior="inside"
      size="2xl"
      onOpenChange={onOpenChange}
    >
      <ModalContent>
        {(onClose) => (
          <>
            <button
              aria-label="关闭开始检测弹窗"
              className="start-detection-modal-close"
              disabled={isPending}
              type="button"
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </button>
            <ModalHeader className="start-detection-modal-header">
              <span className="start-detection-modal-title-icon" aria-hidden="true">
                <ScanLine />
              </span>
              <span className="start-detection-modal-title-copy">开始 AI 检测</span>
            </ModalHeader>
            <ModalBody className="start-detection-modal-body gap-5">
              <div className="start-detection-summary">
                <span className="start-detection-summary-icon" aria-hidden="true">
                  <Images />
                </span>
                <span className="start-detection-summary-copy">
                  <strong>{qualifiedPhotos.length} 张照片将参与检测</strong>
                  <span>仅统计已通过建筑照片预检的照片，系统会自动汇总提交。</span>
                </span>
                <span className="start-detection-ready-badge">已就绪</span>
              </div>

              <fieldset className="start-detection-types">
                <legend>检测类型</legend>
                <div className="start-detection-option-grid">
                  {DETECTION_TYPE_OPTIONS.map((option) => (
                    <label
                      className={`start-detection-option ${
                        modelTypes.includes(option.value) ? "is-selected" : ""
                      }`}
                      key={option.value}
                    >
                      <span className="start-detection-option-heading">
                        <input
                          checked={modelTypes.includes(option.value)}
                          disabled={isPending}
                          type="checkbox"
                          onChange={() => toggleModel(option.value)}
                        />
                        <strong>
                          {option.label}{option.value === "hollow" ? "（Beta）" : ""}
                        </strong>
                      </span>
                      <small>{option.description}</small>
                    </label>
                  ))}
                </div>
                {thermalPhotoCount === 0 ? (
                  <p className="start-detection-notice is-warning">
                    当前未发现热成像照片；即使勾选空鼓，也不会触发空鼓分析。
                  </p>
                ) : null}
                {visiblePhotoCount > 0 ? (
                  <p className="start-detection-notice">
                    {visiblePhotoCount} 张可见光照片只执行裂缝或剥落检测，空鼓选项不会应用于可见光图片。
                  </p>
                ) : null}
              </fieldset>

              {localError || modelSelectionWarning || error ? (
                <p className="start-detection-error" role="alert">
                  {localError || modelSelectionWarning || getErrorMessage(error)}
                </p>
              ) : null}
            </ModalBody>
            <ModalFooter className="start-detection-modal-footer">
              <button
                className="button secondary report-back-button start-detection-cancel-button"
                disabled={isPending}
                type="button"
                onClick={onClose}
              >
                取消
              </button>
              <button
                className="button primary"
                disabled={isPending}
                type="button"
                onClick={submit}
              >
                {isPending ? "正在检测，请稍候…" : "确认并开始检测"}
              </button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

function PrototypeField({ label, required, className = "", children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return <label className={`form-field ${className}`}><span>{label}：{required ? <b>*</b> : null}</span>{children}</label>;
}
