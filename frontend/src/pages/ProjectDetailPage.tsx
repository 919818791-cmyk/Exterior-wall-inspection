import {
  Card,
  CardBody,
  Skeleton
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  ScanSearch
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link as RouterLink,
  useLocation,
  useOutletContext,
  useParams
} from "react-router-dom";

import {
  projectQueryOptions,
  projectPhotosQueryOptions,
  startDetection,
  updateProject
} from "@/api/projects";
import { DetectionCreateWorkspace } from "@/components/project/DetectionCreateWorkbench";
import { ProjectPhotoActions } from "@/components/project/ProjectPhotoActions";
import { ProjectWorkbenchShell } from "@/components/project/ProjectWorkbenchShell";
import { StartDetectionModal } from "@/components/project/StartDetectionModal";
import { useAuthStore } from "@/stores/useAuthStore";
import type {
  Photo,
  ProjectDetail,
  ProjectStatus,
  ProjectUpdatePayload,
  StartDetectionPayload
} from "@/types/projects";

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
      return { label: "开始检测", note: "系统会统一检测预检通过的照片。" };
    case "queued":
      return { label: "检测中", note: "检测任务已提交，正在启动检测。" };
    case "detecting":
      return { label: "检测中", note: "检测完成前项目保持只读。" };
    case "pending_review":
      return { label: "检测中", note: "正在汇总检测结果。" };
    case "reviewed":
      return { label: "查看结果", note: "检测已完成，可查看检测结果。" };
    case "completed":
      return { label: "查看结果", note: "检测已完成，可查看检测结果。" };
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
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const outletContext = useOutletContext<{
    setProjectDetailListChrome: (enabled: boolean) => void;
  } | undefined>();
  const setProjectDetailListChrome = outletContext?.setProjectDetailListChrome;
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

  const canManageProject = Boolean(project && (user?.role === "admin" || project.created_by === user?.id));
  const isEditable = canManageProject && project?.status === "draft";
  const usesNewProjectAppearance = project
    ? ["draft", "queued", "detecting", "pending_review"].includes(project.status)
    : false;
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

  useEffect(() => {
    if (!setProjectDetailListChrome) return undefined;
    setProjectDetailListChrome(usesNewProjectAppearance);
    return () => setProjectDetailListChrome(false);
  }, [setProjectDetailListChrome, usesNewProjectAppearance]);

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
    if (!canManageProject || project?.status !== "draft") return;
    setDetectionModalOpen(true);
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
        canManageProject={canManageProject}
        formError={formError}
        isEditable={isEditable}
        primaryAction={primaryAction}
        project={project}
        usesNewProjectAppearance={usesNewProjectAppearance}
        projectCreationNotice={projectCreationNotice}
        projectDraft={projectDraft}
        startDetectionPending={startDetectionMutation.isPending}
        detectionModalOpen={detectionModalOpen}
        photos={projectPhotosQuery.data ?? []}
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
  usesNewProjectAppearance,
  canManageProject,
  isEditable,
  projectDraft,
  formError,
  activeError,
  primaryAction,
  projectCreationNotice,
  startDetectionPending,
  detectionModalOpen,
  photos,
  onProjectFieldChange,
  onProjectFieldBlur,
  onPrimaryAction,
  onDetectionModalOpenChange,
  onStartDetection
}: {
  project: ProjectDetail;
  usesNewProjectAppearance: boolean;
  canManageProject: boolean;
  isEditable: boolean;
  projectDraft: ProjectBasicDraft;
  formError: string;
  activeError: unknown;
  primaryAction: { label: string; note: string };
  projectCreationNotice: string;
  startDetectionPending: boolean;
  detectionModalOpen: boolean;
  photos: Photo[];
  onProjectFieldChange: (field: keyof ProjectBasicDraft, value: string) => void;
  onProjectFieldBlur: () => void;
  onPrimaryAction: () => void;
  onDetectionModalOpenChange: (isOpen: boolean) => void;
  onStartDetection: (payload: StartDetectionPayload) => void;
}) {
  const qualifiedPhotos = photos.filter((photo) => photo.precheck_status === "passed");
  const rejectedPhotoCount = photos.filter((photo) => photo.precheck_status === "rejected").length;
  const nonDronePhotoCount = photos.filter((photo) => (
    photo.precheck_status === "rejected" && photo.precheck_category === "NON_DRONE"
  )).length;
  const thermalPhotoCount = qualifiedPhotos.filter((photo) => photo.photo_type === "thermal").length;

  if (usesNewProjectAppearance) {
    return (
      <>
        <DetectionCreateWorkspace
          ariaLabel={`${project.name}项目详情`}
          title={`${project.name}项目详情`}
          nameField={(
            <PrototypeField label="检测名称">
              <input
                disabled={!isEditable}
                value={projectDraft.name}
                placeholder="可不填，系统将自动生成"
                onBlur={onProjectFieldBlur}
                onChange={(event) => onProjectFieldChange("name", event.target.value)}
              />
            </PrototypeField>
          )}
          nameActions={(
            <>
              <button
                className="button primary start-ai-detection-button"
                disabled={!canManageProject || project.status !== "draft" || startDetectionPending}
                type="button"
                onClick={onPrimaryAction}
              >
                <ScanSearch aria-hidden="true" />
                {startDetectionPending ? "检测中" : primaryAction.label}
              </button>
            </>
          )}
          photoWorkspaceContent={(
            <section className="project-photo-workspace" aria-labelledby="project-photo-title">
              <ProjectPhotoActions isEditable={isEditable} project={project} />
            </section>
          )}
          feedback={(formError || activeError || projectCreationNotice) ? (
            <>
              {formError || activeError ? (
                <p className="detail-feedback error">{formError || getErrorMessage(activeError)}</p>
              ) : null}
              {projectCreationNotice ? (
                <p className="detail-feedback warning">{projectCreationNotice}</p>
              ) : null}
            </>
          ) : undefined}
        />
        <StartDetectionModal
          error={activeError}
          isProfessional
          isOpen={detectionModalOpen}
          isPending={startDetectionPending}
          nonDronePhotoCount={nonDronePhotoCount}
          qualifiedPhotoCount={qualifiedPhotos.length}
          rejectedPhotoCount={rejectedPhotoCount}
          thermalPhotoCount={thermalPhotoCount}
          onOpenChange={onDetectionModalOpenChange}
          onSubmit={onStartDetection}
        />
      </>
    );
  }

  return (
    <div className="create-workspace project-detail-prototype" id="project-detail-workspace">
      <section className="project-editor-panel" aria-label={`${project.name}项目详情`}>
        {formError || activeError ? <p className="detail-feedback error">{formError || getErrorMessage(activeError)}</p> : null}
        {projectCreationNotice ? <p className="detail-feedback warning">{projectCreationNotice}</p> : null}

        <div className="project-editor-block project-fields project-editor-basic-fields">
          <PrototypeField label="检测名称"><input disabled={!isEditable} value={projectDraft.name} placeholder="可不填，系统将自动生成" onBlur={onProjectFieldBlur} onChange={(event) => onProjectFieldChange("name", event.target.value)} /></PrototypeField>
          <PrototypeField label="检测位置"><input disabled={!isEditable} value={projectDraft.address} onBlur={onProjectFieldBlur} onChange={(event) => onProjectFieldChange("address", event.target.value)} /></PrototypeField>
        </div>

        <div className="project-editor-block project-editor-photo-block">
          <section className="project-photo-workspace" aria-labelledby="project-photo-title">
            <ProjectPhotoActions isEditable={isEditable} project={project} />
          </section>
        </div>

        <div className="create-action-bar detail-action-bar">
          <div className="detail-view-actions">
            {(project.status === "reviewed" || project.status === "completed") && project.current_report_id
              ? <RouterLink className="button primary" to={`/detections/results/${project.current_report_id}`}><FileText aria-hidden="true" />查看结果</RouterLink>
              : <button className="button primary start-ai-detection-button" disabled={!canManageProject || project.status !== "draft" || startDetectionPending} type="button" onClick={onPrimaryAction}><ScanSearch aria-hidden="true" />{startDetectionPending ? "检测中" : primaryAction.label}</button>}
          </div>
        </div>
      </section>
      <StartDetectionModal
        error={activeError}
        isProfessional
        isOpen={detectionModalOpen}
        isPending={startDetectionPending}
        nonDronePhotoCount={nonDronePhotoCount}
        qualifiedPhotoCount={qualifiedPhotos.length}
        rejectedPhotoCount={rejectedPhotoCount}
        thermalPhotoCount={thermalPhotoCount}
        onOpenChange={onDetectionModalOpenChange}
        onSubmit={onStartDetection}
      />
    </div>
  );
}

function PrototypeField({ label, required, className = "", children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return <label className={`form-field ${className}`}><span>{label}：{required ? <b>*</b> : null}</span>{children}</label>;
}
