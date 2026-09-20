import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Box,
  Check,
  FileText,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  createProjectDraft,
  createUploadBatch,
  deleteProject,
  deletePhoto,
  finalizeProject,
  projectPhotosQueryOptions,
  projectQueryOptions,
  startDetection,
  updateProject,
  uploadPhoto
} from "@/api/projects";
import { currentAccountUsageQueryOptions } from "@/api/accounts";
import { ListPagination } from "@/components/ListPagination";
import { ErrorNoticeModal } from "@/components/project/PhotoLimitModal";
import { PhotoUploadThumbnail } from "@/components/project/PhotoUploadThumbnail";
import { ProjectPhotoUploader } from "@/components/project/ProjectPhotoUploader";
import { ProjectWorkbenchShell } from "@/components/project/ProjectWorkbenchShell";
import { StartDetectionModal } from "@/components/project/StartDetectionModal";
import { useAuthStore } from "@/stores/useAuthStore";
import type {
  Photo,
  PhotoPrecheckStatus,
  PhotoType,
  ProjectDetail,
  SelectableFacadeType,
  StartDetectionPayload,
  UploadBatch
} from "@/types/projects";
import { createAsyncLimiter } from "@/utils/asyncLimiter";
import { getDroneTypeLabel } from "@/utils/droneTypes";
import { createClientId } from "@/utils/id";
import {
  MAX_PHOTO_UPLOAD_SIZE_BYTES,
  PROFESSIONAL_PHOTO_UPLOAD_HINT,
  PHOTO_UPLOAD_WINDOW_WARNING,
  validatePhotoUpload
} from "@/utils/photoUpload";

type WizardStep = 1 | 2 | 3;
type PendingPhotoStatus = "pending" | "uploading" | "saved" | "failed";

interface PendingPhoto {
  localId: string;
  file?: File;
  fileName: string;
  fileSize: number;
  ownsPreviewUrl: boolean;
  previewUrl: string;
  remoteId?: string;
  photoType?: PhotoType;
  precheckStatus?: PhotoPrecheckStatus;
  precheckCategory?: string | null;
  precheckReason?: string | null;
  status: PendingPhotoStatus;
}

interface ProjectWizardDraft {
  name: string;
  facadeType: SelectableFacadeType | "";
  description: string;
  photos: PendingPhoto[];
}

const DESCRIPTION_MAX_LENGTH = 500;
const PHOTO_PAGE_SIZE = 20;
const PROFESSIONAL_PROJECT_PHOTO_UPLOAD_BASE_HINT = `${PROFESSIONAL_PHOTO_UPLOAD_HINT}，支持 JPG、JPEG、PNG 格式，单张不超过 ${MAX_PHOTO_UPLOAD_SIZE_BYTES / 1024 / 1024}MB`;
const FACADE_TYPE_OPTIONS: ReadonlyArray<{ value: SelectableFacadeType; label: string }> = [
  { value: "tile", label: "饰面砖" },
  { value: "coating", label: "涂饰" },
  { value: "plaster", label: "抹灰" },
  { value: "panel", label: "饰面板" },
  { value: "curtain_wall", label: "幕墙" }
];
const runFormalPhotoUpload = createAsyncLimiter(6);
const WIZARD_STEPS: ReadonlyArray<{ step: WizardStep; label: string }> = [
  { step: 1, label: "项目信息" },
  { step: 2, label: "上传照片" },
  { step: 3, label: "确认检测" }
];

function createInitialDraft(): ProjectWizardDraft {
  return {
    name: "",
    facadeType: "",
    description: "",
    photos: []
  };
}

function cleanOptionalText(value: string) {
  return value.trim() || null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function storedPhotoToPending(photo: Photo): PendingPhoto {
  return {
    localId: photo.id,
    fileName: photo.original_filename,
    fileSize: photo.file_size ?? 0,
    ownsPreviewUrl: false,
    previewUrl: photo.thumbnail_url ?? photo.preview_url ?? "",
    remoteId: photo.id,
    photoType: photo.photo_type,
    precheckStatus: photo.precheck_status,
    precheckCategory: photo.precheck_category,
    precheckReason: photo.precheck_reason,
    status: "saved"
  };
}

function hasProjectDetailChanges(project: ProjectDetail, draft: ProjectWizardDraft) {
  return project.name !== draft.name.trim()
    || project.facade_type !== draft.facadeType
    || (project.description ?? null) !== cleanOptionalText(draft.description);
}

export function NewProjectPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const accountUsageQuery = useQuery({
    ...currentAccountUsageQueryOptions,
    enabled: user?.role === "customer"
  });
  const formalQuotaRemaining = user?.account_plan === "professional"
    ? accountUsageQuery.data?.professional_formal_monthly_photo_upload_balance.remaining
    : accountUsageQuery.data?.basic_formal_monthly_photo_upload_balance.remaining;
  const professionalProjectPhotoUploadHint = formalQuotaRemaining === undefined
    ? PROFESSIONAL_PROJECT_PHOTO_UPLOAD_BASE_HINT
    : `照片数量最多 ${formalQuotaRemaining} 张，${PROFESSIONAL_PROJECT_PHOTO_UPLOAD_BASE_HINT}`;
  const projectQuery = useQuery(projectQueryOptions(id));
  const storedPhotosQuery = useQuery(projectPhotosQueryOptions(id));
  const clientDraftKeyRef = useRef(createClientId("draft").slice(0, 64));
  const previewUrlsRef = useRef(new Set<string>());
  const projectRef = useRef<ProjectDetail | null>(null);
  const uploadBatchRef = useRef<UploadBatch | null>(null);
  const resourcePromiseRef = useRef<Promise<{ project: ProjectDetail; batch: UploadBatch }> | null>(null);
  const hydratedProjectIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const [projectSnapshot, setProjectSnapshot] = useState<ProjectDetail | null>(null);
  const [step, setStep] = useState<WizardStep>(1);
  const [form, setForm] = useState<ProjectWizardDraft>(() => createInitialDraft());
  const formRef = useRef(form);
  const [detailsTouched, setDetailsTouched] = useState({
    projectName: false,
    facadeType: false
  });
  const [pageError, setPageError] = useState("");
  const [loadErrorOpen, setLoadErrorOpen] = useState(true);
  const [savePending, setSavePending] = useState(false);
  const [detectionModalOpen, setDetectionModalOpen] = useState(false);
  const [photoPage, setPhotoPage] = useState(1);
  const [removingPhotoIds, setRemovingPhotoIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      previewUrlsRef.current.forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
      previewUrlsRef.current.clear();
    };
  }, []);

  const replaceForm = (nextForm: ProjectWizardDraft) => {
    formRef.current = nextForm;
    if (mountedRef.current) setForm(nextForm);
  };

  const setCurrentProject = (project: ProjectDetail) => {
    projectRef.current = project;
    if (mountedRef.current) setProjectSnapshot(project);
  };

  useEffect(() => {
    if (!id || !projectQuery.data) return;
    projectRef.current = projectQuery.data;
    setProjectSnapshot(projectQuery.data);
  }, [id, projectQuery.data]);

  useEffect(() => {
    const project = projectQuery.data;
    const photos = storedPhotosQuery.data;
    if (!id || !project || !photos || hydratedProjectIdRef.current === id) return;

    previewUrlsRef.current.forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
    previewUrlsRef.current.clear();
    replaceForm({
      name: project.name,
      facadeType: project.facade_type === "stone" ? "" : project.facade_type,
      description: project.description ?? "",
      photos: photos.map(storedPhotoToPending)
    });
    hydratedProjectIdRef.current = id;
    setStep(project.status === "draft" && project.setup_step !== 3 ? 2 : 3);
  }, [id, projectQuery.data, storedPhotosQuery.data]);

  const updateTextField = (field: "name" | "description", value: string) => {
    replaceForm({ ...formRef.current, [field]: value });
    setPageError("");
  };

  const updateFacadeType = (facadeType: SelectableFacadeType | "") => {
    replaceForm({ ...formRef.current, facadeType });
    setPageError("");
  };

  const updatePhoto = (
    localId: string,
    update: Partial<Omit<PendingPhoto, "localId" | "file" | "fileName" | "fileSize" | "ownsPreviewUrl" | "previewUrl">>
  ) => {
    replaceForm({
      ...formRef.current,
      photos: formRef.current.photos.map((photo) => (
        photo.localId === localId ? { ...photo, ...update } : photo
      ))
    });
  };

  const ensureDraftResources = async () => {
    if (projectRef.current && uploadBatchRef.current) {
      return { project: projectRef.current, batch: uploadBatchRef.current };
    }
    if (resourcePromiseRef.current) return resourcePromiseRef.current;

    const promise = (async () => {
      const draft = formRef.current;
      if (!draft.facadeType) throw new Error("请先选择外墙类型。");

      let project = projectRef.current;
      if (!project) {
        project = await createProjectDraft({
          client_draft_key: clientDraftKeyRef.current,
          name: draft.name.trim(),
          facade_type: draft.facadeType,
          description: cleanOptionalText(draft.description),
          address: null,
          longitude: null,
          latitude: null
        });
        setCurrentProject(project);
      }

      let batch = uploadBatchRef.current;
      if (!batch) {
        batch = await createUploadBatch(project.id, {
          drone_type: null,
          remark: cleanOptionalText(draft.description),
          upload_mode: "dji"
        });
        uploadBatchRef.current = batch;
      }
      return { project, batch };
    })();

    resourcePromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      if (resourcePromiseRef.current === promise) resourcePromiseRef.current = null;
    }
  };

  const uploadEntries = async (entries: PendingPhoto[]) => {
    let failedCount = 0;
    let firstFailureMessage = "";
    let savedCount = 0;
    await Promise.all(entries.map((entry) => runFormalPhotoUpload(async () => {
      updatePhoto(entry.localId, { status: "uploading" });
      try {
        if (!entry.file) throw new Error("本地照片文件已失效，请重新选择。");
        const { project, batch } = await ensureDraftResources();
        const photoPayload = new FormData();
        photoPayload.append("project_id", project.id);
        photoPayload.append("upload_batch_id", batch.id);
        photoPayload.append("photo_type", "dji");
        photoPayload.append("file", entry.file);
        const uploadedPhoto = await uploadPhoto(photoPayload);
        savedCount += 1;
        updatePhoto(entry.localId, {
          photoType: uploadedPhoto.photo_type,
          precheckStatus: uploadedPhoto.precheck_status,
          precheckCategory: uploadedPhoto.precheck_category,
          precheckReason: uploadedPhoto.precheck_reason,
          remoteId: uploadedPhoto.id,
          status: "saved"
        });
      } catch (error) {
        const message = getErrorMessage(error);
        failedCount += 1;
        firstFailureMessage ||= message;
        updatePhoto(entry.localId, { status: "failed" });
      }
    })));

    const project = projectRef.current;
    if (project) {
      if (savedCount) {
        const activeProject = {
          ...project,
          setup_completed_at: project.setup_completed_at ?? new Date().toISOString()
        };
        setCurrentProject(activeProject);
        queryClient.setQueryData(["projects", project.id], activeProject);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["projects", project.id] }),
        queryClient.invalidateQueries({ queryKey: ["projects", project.id, "photos"] })
      ]);
      if (savedCount && !id) {
        hydratedProjectIdRef.current = project.id;
        navigate(`/detections/${project.id}`, { replace: true });
      }
    }
    if (failedCount && mountedRef.current) {
      setPageError(firstFailureMessage || `${failedCount} 张照片上传失败，请移除后重新上传。`);
    }
  };

  const applyFiles = (files: File[]) => {
    if (!files.length || savePending) return;

    const rejectionMessages: string[] = [];
    const validFiles = files.filter((file) => {
      const message = validatePhotoUpload(file, { maxSizeBytes: MAX_PHOTO_UPLOAD_SIZE_BYTES });
      if (!message) return true;
      rejectionMessages.push(`${file.name}：${message}`);
      return false;
    });
    if (!validFiles.length) {
      setPageError(rejectionMessages[0] ?? "未选择可上传的图片。");
      return;
    }

    const quotaBalance = user?.account_plan === "professional"
      ? accountUsageQuery.data?.professional_formal_monthly_photo_upload_balance
      : accountUsageQuery.data?.basic_formal_monthly_photo_upload_balance;
    const pendingUploadCount = formRef.current.photos.filter((photo) => photo.status !== "failed").length;
    const availableUploadCount = quotaBalance
      ? Math.max(0, quotaBalance.remaining - pendingUploadCount)
      : null;
    if (availableUploadCount !== null && validFiles.length > availableUploadCount) {
      setPageError(
        `账号专业检测照片额度剩余 ${quotaBalance?.remaining ?? 0} 张，`
        + `当前已有 ${pendingUploadCount} 张未送检照片，本次最多还能上传 ${availableUploadCount} 张。`
      );
      return;
    }

    const entries = validFiles.map((file): PendingPhoto => {
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      return {
        localId: createClientId("project-photo"),
        file,
        fileName: file.name,
        fileSize: file.size,
        ownsPreviewUrl: true,
        previewUrl,
        status: "pending"
      };
    });
    const nextPhotos = [...formRef.current.photos, ...entries];
    replaceForm({
      ...formRef.current,
      photos: nextPhotos
    });
    setPhotoPage(Math.max(1, Math.ceil(nextPhotos.length / PHOTO_PAGE_SIZE)));
    setPageError(rejectionMessages[0] ?? "");
    void uploadEntries(entries);
  };

  const removePhoto = async (photo: PendingPhoto) => {
    if (photo.status === "uploading" || removingPhotoIds.has(photo.localId)) return;
    setRemovingPhotoIds((current) => new Set(current).add(photo.localId));
    setPageError("");
    try {
      if (photo.remoteId) await deletePhoto(photo.remoteId);
      replaceForm({
        ...formRef.current,
        photos: formRef.current.photos.filter((item) => item.localId !== photo.localId)
      });
      if (photo.ownsPreviewUrl) {
        URL.revokeObjectURL(photo.previewUrl);
        previewUrlsRef.current.delete(photo.previewUrl);
      }
      const projectId = projectRef.current?.id;
      if (projectId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["projects", "list"] }),
          queryClient.invalidateQueries({ queryKey: ["projects", projectId] }),
          queryClient.invalidateQueries({ queryKey: ["projects", projectId, "photos"] })
        ]);
      }
    } catch (error) {
      setPageError(getErrorMessage(error));
    } finally {
      if (mountedRef.current) {
        setRemovingPhotoIds((current) => {
          const next = new Set(current);
          next.delete(photo.localId);
          return next;
        });
      }
    }
  };

  const counts = useMemo(() => {
    const passed = form.photos.filter((photo) => (
      photo.status === "saved" && photo.precheckStatus === "passed"
    )).length;
    const rejected = form.photos.filter((photo) => (
      photo.status === "saved" && photo.precheckStatus === "rejected"
    )).length;
    const precheckError = form.photos.filter((photo) => (
      photo.status === "saved" && photo.precheckStatus === "error"
    )).length;
    const precheckPending = form.photos.filter((photo) => (
      photo.status === "saved"
      && (photo.precheckStatus === "pending" || photo.precheckStatus === "running")
    )).length;
    const uploading = form.photos.filter((photo) => (
      photo.status === "pending" || photo.status === "uploading"
    )).length;
    const failed = form.photos.filter((photo) => photo.status === "failed").length;
    return {
      failed,
      passed,
      precheckError,
      precheckPending,
      rejected,
      total: form.photos.length,
      totalBytes: form.photos.reduce((total, photo) => total + photo.fileSize, 0),
      uploading
    };
  }, [form.photos]);

  const totalPhotoPages = Math.max(1, Math.ceil(form.photos.length / PHOTO_PAGE_SIZE));
  const visiblePhotoPage = Math.min(photoPage, totalPhotoPages);
  const paginatedPhotos = useMemo(() => {
    const startIndex = (visiblePhotoPage - 1) * PHOTO_PAGE_SIZE;
    return form.photos.slice(startIndex, startIndex + PHOTO_PAGE_SIZE);
  }, [form.photos, visiblePhotoPage]);

  const project = projectSnapshot;
  const canManageProject = !project
    || user?.role === "admin"
    || project.created_by === user?.id;
  const isEditable = Boolean(
    !project || (
      canManageProject
      && !project.is_example
      && project.status === "draft"
    )
  );
  const hasResult = Boolean(
    project
    && (project.status === "reviewed" || project.status === "completed")
    && project.current_report_id
  );
  const isDetectionLocked = Boolean(project && project.status !== "draft" && !hasResult);
  const canOpenSummary = counts.passed > 0
    && counts.uploading === 0
    && counts.failed === 0
    && counts.precheckPending === 0
    && counts.precheckError === 0
    && removingPhotoIds.size === 0;
  const projectNameMissing = !form.name.trim();
  const facadeTypeMissing = !form.facadeType;
  const projectNameInvalid = detailsTouched.projectName && projectNameMissing;
  const facadeTypeInvalid = detailsTouched.facadeType && facadeTypeMissing;
  const canContinueFromDetails = !projectNameMissing && !facadeTypeMissing;
  const detailsChanged = Boolean(project && hasProjectDetailChanges(project, form));
  const furthestAccessibleStep: WizardStep = project
    ? (project.setup_step === 3 ? 3 : 2)
    : 1;

  const persistProjectDetails = async () => {
    const currentProject = projectRef.current;
    const draft = formRef.current;
    if (currentProject && !hasProjectDetailChanges(currentProject, draft)) {
      return currentProject;
    }

    const savedProject = currentProject
      ? await updateProject(currentProject.id, {
        name: draft.name.trim(),
        facade_type: draft.facadeType || "tile",
        description: cleanOptionalText(draft.description)
      })
      : await createProjectDraft({
        client_draft_key: clientDraftKeyRef.current,
        name: draft.name.trim(),
        facade_type: draft.facadeType || "tile",
        description: cleanOptionalText(draft.description),
        address: null,
        longitude: null,
        latitude: null
      });
    setCurrentProject(savedProject);
    queryClient.setQueryData(["projects", savedProject.id], savedProject);
    await queryClient.invalidateQueries({ queryKey: ["projects", "list"] });
    if (!currentProject && !id) {
      navigate(`/detections/${savedProject.id}`, { replace: true });
    }
    return savedProject;
  };

  const continueFromDetails = async () => {
    if (!canContinueFromDetails || !isEditable || !form.facadeType) return;
    setSavePending(true);
    setPageError("");
    try {
      await persistProjectDetails();
      setStep(2);
    } catch (error) {
      setPageError(getErrorMessage(error));
    } finally {
      if (mountedRef.current) setSavePending(false);
    }
  };

  const continueToSummary = async () => {
    if (counts.uploading || counts.precheckPending) {
      setPageError("请等待所有照片上传和预检完成。");
      return;
    }
    if (counts.failed) {
      setPageError("存在上传失败的照片，请移除后重新上传。");
      return;
    }
    if (counts.precheckError) {
      setPageError("存在预检失败的照片，请删除后重新上传。");
      return;
    }
    if (!counts.passed) {
      setPageError("当前没有通过预检的照片，请上传合格照片后继续。");
      return;
    }
    const currentProject = projectRef.current;
    if (!currentProject || !form.facadeType) {
      setPageError("项目尚未成功创建，请重新上传照片后重试。");
      return;
    }

    setSavePending(true);
    setPageError("");
    try {
      const readyProject = await finalizeProject(currentProject.id, {
        name: form.name.trim(),
        facade_type: form.facadeType,
        description: cleanOptionalText(form.description)
      });
      setCurrentProject(readyProject);
      queryClient.setQueryData(["projects", readyProject.id], readyProject);
      await queryClient.invalidateQueries({ queryKey: ["projects", "list"] });
      setStep(3);
    } catch (error) {
      setPageError(getErrorMessage(error));
    } finally {
      if (mountedRef.current) setSavePending(false);
    }
  };

  const leaveWizard = () => {
    if (counts.uploading) {
      setPageError("照片正在上传，请等待上传完成后再返回列表。");
      return;
    }
    navigate("/detections");
  };

  const startDetectionMutation = useMutation({
    mutationFn: ({ projectId, payload }: { projectId: string; payload: StartDetectionPayload }) => (
      startDetection(projectId, payload)
    ),
    onSuccess: async (_, { projectId }) => {
      setDetectionModalOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["projects", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["projects", projectId, "photos"] }),
        queryClient.invalidateQueries({ queryKey: ["current-account-usage"] })
      ]);
      const refreshedProject = await queryClient.fetchQuery(projectQueryOptions(projectId));
      setCurrentProject(refreshedProject);
      setStep(3);
    },
    onError: (error) => setPageError(getErrorMessage(error))
  });

  const deleteProjectMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: async (_, projectId) => {
      queryClient.removeQueries({ queryKey: ["projects", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects", "list"] });
      navigate("/detections", { replace: true });
    },
    onError: (error) => setPageError(getErrorMessage(error))
  });

  const canDeleteProject = Boolean(
    project
    && !project.is_example
    && canManageProject
    && ["draft", "reviewed", "completed"].includes(project.status)
  );
  const deleteProjectDisabledReason = project?.is_example
    ? "示例项目为所有账号共享，无法删除"
    : !canManageProject
      ? "仅项目所有者或管理员可以删除"
      : "检测进行中，无法删除";
  const handleDeleteProject = () => {
    if (!project || !canDeleteProject) return;
    if (!window.confirm(`确认删除检测“${project.name}”？删除后将无法恢复。`)) return;
    deleteProjectMutation.mutate(project.id);
  };

  const busy = savePending || startDetectionMutation.isPending || deleteProjectMutation.isPending;
  const canNavigateToWizardStep = (targetStep: WizardStep) => (
    targetStep !== step
    && targetStep <= furthestAccessibleStep
    && !busy
    && (isEditable || (hasResult && targetStep >= 2))
  );
  const navigateToWizardStep = async (targetStep: WizardStep) => {
    if (!canNavigateToWizardStep(targetStep)) return;

    if (!isEditable) {
      setPageError("");
      setStep(targetStep);
      return;
    }

    if (step === 1 && !canContinueFromDetails) {
      setDetailsTouched({ projectName: true, facadeType: true });
      setPageError("请先完成所有必填项。");
      return;
    }

    const currentProject = projectRef.current;
    if (step !== 1 || !currentProject || !hasProjectDetailChanges(currentProject, formRef.current)) {
      setPageError("");
      setStep(targetStep);
      return;
    }

    setSavePending(true);
    setPageError("");
    try {
      await persistProjectDetails();
      setStep(targetStep);
    } catch (error) {
      setPageError(getErrorMessage(error));
    } finally {
      if (mountedRef.current) setSavePending(false);
    }
  };
  const thermalPhotoCount = form.photos.filter((photo) => (
    photo.status === "saved"
    && photo.precheckStatus === "passed"
    && photo.photoType === "thermal"
  )).length;
  const nonDronePhotoCount = form.photos.filter((photo) => (
    photo.status === "saved"
    && photo.precheckStatus === "rejected"
    && photo.precheckCategory === "NON_DRONE"
  )).length;

  if (id && (projectQuery.isLoading || storedPhotosQuery.isLoading)) {
    return (
      <ProjectWorkbenchShell actionLabel="返回" hideHeader>
        <main className="professional-create-wizard">
          <header className="professional-create-wizard-header"><h1>正在加载项目</h1></header>
        </main>
      </ProjectWorkbenchShell>
    );
  }

  if (id && (projectQuery.isError || storedPhotosQuery.isError || !project)) {
    const loadErrorMessage = getErrorMessage(projectQuery.error ?? storedPhotosQuery.error);
    return (
      <ProjectWorkbenchShell actionLabel="返回" hideHeader>
        <main className="professional-create-wizard">
          <header className="professional-create-wizard-header"><h1>项目加载失败</h1></header>
          <footer className="professional-create-actions">
            <button className="back-cancel-button" type="button" onClick={() => navigate("/detections")}>返回列表</button>
          </footer>
        </main>
        <ErrorNoticeModal
          message={loadErrorOpen ? loadErrorMessage : ""}
          title="项目加载失败"
          onOpenChange={setLoadErrorOpen}
        />
      </ProjectWorkbenchShell>
    );
  }

  return (
    <ProjectWorkbenchShell actionLabel="返回" hideHeader>
      <main className="professional-create-wizard">
        <header className="professional-create-wizard-header">
          <h1>{project?.name || form.name.trim() || "新增检测项目"}</h1>
        </header>

        <ol className="professional-create-steps" aria-label="项目设置步骤">
          {WIZARD_STEPS.map((item) => {
            const isCurrent = item.step === step;
            const isComplete = item.step < step;
            const isReached = item.step <= step;
            return (
              <li
                className={`${isCurrent ? "is-current" : ""} ${isComplete ? "is-complete" : ""}`.trim()}
                key={item.step}
              >
                <button
                  aria-current={isCurrent ? "step" : undefined}
                  disabled={!canNavigateToWizardStep(item.step)}
                  type="button"
                  onClick={() => void navigateToWizardStep(item.step)}
                >
                  <span aria-hidden="true" className="professional-create-step-number">
                    {isReached ? <Check /> : item.step}
                  </span>
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {step === 1 || step === 3 ? (
          <h2 className="professional-create-content-heading">
            {step === 1 ? "填写项目信息" : "确认项目信息"}
          </h2>
        ) : null}

        <section className={`professional-create-panel ${step === 2 ? "professional-create-panel--photos" : ""}`}>
          {step === 1 ? (
            <div className="professional-create-details">
              <div className="professional-create-field-grid">
                <label className="professional-create-field floating-line-field">
                  <input
                    aria-describedby={projectNameInvalid ? "professional-project-name-required" : undefined}
                    aria-invalid={projectNameInvalid}
                    disabled={!isEditable || busy}
                    maxLength={128}
                    onBlur={() => setDetailsTouched((current) => ({ ...current, projectName: true }))}
                    placeholder=" "
                    required
                    value={form.name}
                    onChange={(event) => updateTextField("name", event.target.value)}
                  />
                  <span>项目名称 <b>*</b></span>
                  {projectNameInvalid ? (
                    <small className="floating-line-field-error" id="professional-project-name-required">必填项</small>
                  ) : null}
                </label>
                <label className="professional-create-field floating-line-field">
                  <select
                    aria-describedby={facadeTypeInvalid ? "professional-facade-type-required" : undefined}
                    aria-invalid={facadeTypeInvalid}
                    disabled={!isEditable || busy}
                    onBlur={() => setDetailsTouched((current) => ({ ...current, facadeType: true }))}
                    required
                    value={form.facadeType}
                    onChange={(event) => updateFacadeType(event.target.value as SelectableFacadeType | "")}
                  >
                    <option disabled hidden value="" />
                    {FACADE_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <span>外墙类型 <b>*</b></span>
                  {facadeTypeInvalid ? (
                    <small className="floating-line-field-error" id="professional-facade-type-required">必填项</small>
                  ) : null}
                </label>
                <label className="professional-create-field floating-line-field">
                  <input
                    disabled={!isEditable || busy}
                    maxLength={DESCRIPTION_MAX_LENGTH}
                    placeholder=" "
                    value={form.description}
                    onChange={(event) => updateTextField("description", event.target.value)}
                  />
                  <span>描述 <small>选填</small></span>
                </label>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="professional-create-photos">
              <ProjectPhotoUploader
                addDisabled={!isEditable || busy}
                disabled={!isEditable || busy}
                emptyHint={(
                  <span className="professional-drone-upload-hint">
                    {professionalProjectPhotoUploadHint}
                    {counts.uploading ? (
                      <>
                        <br />
                        <span role="status">
                          正在上传 {counts.uploading} 张，
                          <span className="photo-upload-window-warning">{PHOTO_UPLOAD_WINDOW_WARNING}</span>
                        </span>
                      </>
                    ) : null}
                  </span>
                )}
                hasPhotos={Boolean(form.photos.length)}
                onFilesSelected={applyFiles}
                presentation="line"
              >
                {paginatedPhotos.map((photo) => {
                  const isChecking = photo.status === "saved"
                    && (photo.precheckStatus === "pending" || photo.precheckStatus === "running");
                  const isRemoving = removingPhotoIds.has(photo.localId);
                  const thermalAvailable = photo.status === "saved" && photo.photoType === "thermal";
                  return (
                    <PhotoUploadThumbnail
                      badges={(
                        <>
                          {photo.precheckStatus === "passed" ? (
                            <span className="professional-photo-status-badge">检测通过</span>
                          ) : null}
                          {thermalAvailable ? <span className="trial-thermal-available-tag">热成像</span> : null}
                        </>
                      )}
                      fileName={photo.fileName}
                      key={photo.localId}
                      precheckCategory={photo.precheckCategory}
                      precheckReason={photo.precheckReason}
                      precheckStatus={photo.precheckStatus}
                      previewUrl={photo.previewUrl}
                      removeDisabled={!isEditable || busy || photo.status === "uploading" || isRemoving}
                      removePlacement="footer"
                      statusClassName={`is-${photo.status}`}
                      onRemove={isEditable ? () => void removePhoto(photo) : undefined}
                    >
                      {photo.status === "pending" || photo.status === "uploading" || isChecking || isRemoving ? (
                        <span
                          aria-label={`${photo.fileName}${isRemoving ? "正在移除" : isChecking ? "正在预检" : "正在上传"}`}
                          className="new-project-photo-upload-indicator"
                          role="status"
                        >
                          <span aria-hidden="true" className="new-project-photo-upload-ring" />
                          <small>{isRemoving ? "移除中" : isChecking ? "检测中" : "上传中"}</small>
                        </span>
                      ) : null}
                    </PhotoUploadThumbnail>
                  );
                })}
              </ProjectPhotoUploader>

              {counts.precheckError ? (
                <div className="professional-create-photo-counts" aria-label="照片检测汇总">
                  <span className="is-error">预检失败 {counts.precheckError}</span>
                </div>
              ) : null}

              <ListPagination
                ariaLabel="照片分页"
                className="professional-create-photo-pagination"
                currentPage={visiblePhotoPage}
                itemUnit="张"
                onPageChange={setPhotoPage}
                pageSize={PHOTO_PAGE_SIZE}
                showWhenEmpty
                totalItems={form.photos.length}
              />
            </div>
          ) : null}

          {step === 3 ? (
            <div className="professional-create-summary">
              <dl className="professional-create-summary-text">
                <div><dt>项目名称</dt><dd>{form.name.trim()}</dd></div>
                <div><dt>无人机型号</dt><dd>{project?.drone_type ? getDroneTypeLabel(project.drone_type) : "未识别"}</dd></div>
                <div><dt>外墙类型</dt><dd>{FACADE_TYPE_OPTIONS.find((option) => option.value === form.facadeType)?.label}</dd></div>
                <div><dt>描述</dt><dd>{form.description.trim() || "未填写"}</dd></div>
                <div><dt>已选择照片</dt><dd>{counts.total} 张</dd></div>
                <div><dt>有效照片</dt><dd>{counts.passed} 张</dd></div>
                <div><dt>文件总大小</dt><dd>{formatBytes(counts.totalBytes)}</dd></div>
              </dl>
            </div>
          ) : null}

        </section>

        <footer className="professional-create-actions">
          <button
            className="back-cancel-button"
            disabled={busy}
            type="button"
            onClick={leaveWizard}
          >
            {project ? "返回列表" : "取消"}
          </button>
          {project?.has_building_model ? (
            <button
              className="back-cancel-button"
              disabled={busy}
              type="button"
              onClick={() => navigate(`/detections/${project.id}/model`, {
                state: { projectTitle: project.name }
              })}
            >
              <Box aria-hidden="true" />
              3D模型
            </button>
          ) : null}
          {project ? (
            <button
              aria-busy={deleteProjectMutation.isPending}
              className="button destructive-action-button"
              disabled={busy || !canDeleteProject}
              title={canDeleteProject ? `删除：${project.name}` : deleteProjectDisabledReason}
              type="button"
              onClick={handleDeleteProject}
            >
              <Trash2 aria-hidden="true" />
              {deleteProjectMutation.isPending ? "删除中" : "删除"}
            </button>
          ) : null}
          {step === 1 ? (
            <button
              className={`button primary-action-button professional-create-details-action${project && detailsChanged ? " is-save" : ""}`}
              disabled={busy || !isEditable || !canContinueFromDetails}
              type="button"
              onClick={() => void continueFromDetails()}
            >
              {project
                ? (detailsChanged ? "保存并继续" : "继续")
                : "创建项目"}
              <ArrowRight aria-hidden="true" className="professional-create-action-arrow" />
            </button>
          ) : null}
          {step === 2 && isEditable ? (
            <button
              className="button primary-action-button professional-create-next-action"
              disabled={busy || !isEditable || !canOpenSummary}
              type="button"
              onClick={() => void continueToSummary()}
            >
              继续
              <ArrowRight aria-hidden="true" className="professional-create-action-arrow" />
            </button>
          ) : null}
          {step === 3 && hasResult && project?.current_report_id ? (
            <button
              className="button primary-action-button professional-create-result-action"
              type="button"
              onClick={() => navigate(`/detections/results/${project.current_report_id}`)}
            >
              <FileText aria-hidden="true" />
              查看结果
            </button>
          ) : null}
          {step === 3 && !hasResult ? (
            <button
              className="button primary-action-button professional-create-submit"
              disabled={busy || !isEditable || !canOpenSummary}
              type="button"
              onClick={() => setDetectionModalOpen(true)}
            >
              {isDetectionLocked ? "检测中" : "开始检测"}
            </button>
          ) : null}
        </footer>
      </main>

      <ErrorNoticeModal
        message={pageError}
        title="错误提示"
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setPageError("");
          }
        }}
      />
      <StartDetectionModal
        canGenerateBuildingModel={Boolean(user && (user.role !== "customer" || user.account_plan === "professional"))}
        facadeType={form.facadeType || undefined}
        isProfessional
        isOpen={detectionModalOpen}
        isPending={startDetectionMutation.isPending}
        nonDronePhotoCount={nonDronePhotoCount}
        qualifiedPhotoCount={counts.passed}
        rejectedPhotoCount={counts.rejected}
        thermalPhotoCount={thermalPhotoCount}
        onOpenChange={setDetectionModalOpen}
        onSubmit={(payload) => {
          const currentProject = projectRef.current;
          if (!currentProject) return;
          setPageError("");
          startDetectionMutation.mutate({ projectId: currentProject.id, payload });
        }}
      />
    </ProjectWorkbenchShell>
  );
}
