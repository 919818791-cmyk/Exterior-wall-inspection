import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send } from "lucide-react";
import {
  useEffect,
  useRef,
  useState
} from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  createProjectDraft,
  createUploadBatch,
  deletePhoto,
  updateProject,
  uploadPhoto
} from "@/api/projects";
import { DetectionCreateWorkbench } from "@/components/project/DetectionCreateWorkbench";
import { PhotoUploadThumbnail } from "@/components/project/PhotoUploadThumbnail";
import { ProjectPhotoUploader } from "@/components/project/ProjectPhotoUploader";
import type {
  PhotoType,
  PhotoPrecheckStatus,
  ProjectCreatePayload,
  ProjectDetail
} from "@/types/projects";
import { createClientId } from "@/utils/id";
import {
  MAX_PROJECT_PHOTO_COUNT,
  MAX_PROJECT_PHOTO_SIZE_BYTES,
  validatePhotoUpload
} from "@/utils/photoUpload";

interface PendingPhoto {
  localId: string;
  file: File;
  previewUrl: string;
  remoteId?: string;
  photoType?: PhotoType;
  precheckStatus?: PhotoPrecheckStatus;
  precheckCategory?: string | null;
  precheckReason?: string | null;
  status: "pending" | "uploading" | "saved" | "failed";
}

interface ProjectDraft {
  name: string;
  photos: PendingPhoto[];
}

interface RemovedPendingPhoto {
  index: number;
  photo: PendingPhoto;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

const PROJECT_AUTO_SAVE_DELAY_MS = 600;
const PHOTO_DELETE_UNDO_MILLISECONDS = 6000;

function createInitialProject(): ProjectDraft {
  return {
    name: "",
    photos: []
  };
}

const cleanText = (value: string) => value.trim() || null;

function toPayload(form: ProjectDraft): { payload: ProjectCreatePayload | null; error: string } {
  return {
    error: "",
    payload: {
      name: cleanText(form.name),
      address: null,
      longitude: null,
      latitude: null
    }
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "保存失败，请稍后重试。";
}

export function NewProjectPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const clientDraftKeyRef = useRef(createClientId("draft").slice(0, 64));
  const previewUrlsRef = useRef(new Set<string>());
  const [form, setForm] = useState<ProjectDraft>(() => createInitialProject());
  const formRef = useRef(form);
  const savedProjectRef = useRef<ProjectDetail | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const syncRunningRef = useRef(false);
  const syncQueuedRef = useRef(false);
  const syncPromiseRef = useRef<Promise<ProjectDetail | null> | null>(null);
  const formRevisionRef = useRef(0);
  const photoDeleteTimerRef = useRef<number | null>(null);
  const removedPhotoRef = useRef<RemovedPendingPhoto | null>(null);
  const [formError, setFormError] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [startDetectionPending, setStartDetectionPending] = useState(false);
  const [recentlyRemovedPhoto, setRecentlyRemovedPhoto] = useState<RemovedPendingPhoto | null>(null);

  useEffect(() => () => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    if (photoDeleteTimerRef.current !== null) {
      window.clearTimeout(photoDeleteTimerRef.current);
    }
    const removed = removedPhotoRef.current;
    if (removed?.photo.remoteId) {
      void deletePhoto(removed.photo.remoteId);
    }
    if (removed) {
      URL.revokeObjectURL(removed.photo.previewUrl);
      previewUrlsRef.current.delete(removed.photo.previewUrl);
    }
    previewUrlsRef.current.forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
    previewUrlsRef.current.clear();
  }, []);

  const replaceForm = (nextForm: ProjectDraft) => {
    formRef.current = nextForm;
    setForm(nextForm);
  };

  const updatePhoto = (
    localId: string,
    update: Partial<Pick<
      PendingPhoto,
      "photoType" | "precheckStatus" | "precheckCategory" | "precheckReason" | "remoteId" | "status"
    >>
  ) => {
    replaceForm({
      ...formRef.current,
      photos: formRef.current.photos.map((photo) => (
        photo.localId === localId ? { ...photo, ...update } : photo
      ))
    });
  };

  const syncDraftOnce = async () => {
    const revisionAtStart = formRevisionRef.current;
    const result = toPayload(formRef.current);
    if (!result.payload) {
      setFormError(result.error);
      throw new Error(result.error);
    }

    setSaveStatus("saving");
    setSaveError("");

    let project = savedProjectRef.current;
    if (project) {
      project = await updateProject(project.id, {
        name: result.payload.name,
        address: null,
        longitude: null,
        latitude: null
      });
    } else {
      project = await createProjectDraft({
        ...result.payload,
        client_draft_key: clientDraftKeyRef.current
      });
    }
    savedProjectRef.current = project;

    const photosToUpload = formRef.current.photos.filter(
      (photo) => !photo.remoteId && photo.status !== "uploading"
    );
    if (photosToUpload.length) {
      photosToUpload.forEach((photo) => updatePhoto(photo.localId, { status: "uploading" }));
      let batch;
      try {
        batch = await createUploadBatch(project.id, {
          drone_type: null,
          remark: null,
          upload_mode: "dji"
        });
      } catch (error) {
        photosToUpload.forEach((photo) => updatePhoto(photo.localId, { status: "failed" }));
        throw error;
      }
      let failedUploadCount = 0;

      for (const photo of photosToUpload) {
        try {
          const photoPayload = new FormData();
          photoPayload.append("project_id", project.id);
          photoPayload.append("upload_batch_id", batch.id);
          photoPayload.append("photo_type", "dji");
          photoPayload.append("file", photo.file);
          const uploadedPhoto = await uploadPhoto(photoPayload);
          updatePhoto(photo.localId, {
            photoType: uploadedPhoto.photo_type,
            precheckStatus: uploadedPhoto.precheck_status,
            precheckCategory: uploadedPhoto.precheck_category,
            precheckReason: uploadedPhoto.precheck_reason,
            remoteId: uploadedPhoto.id,
            status: "saved"
          });
        } catch {
          failedUploadCount += 1;
          updatePhoto(photo.localId, { status: "failed" });
        }
      }

      if (failedUploadCount) {
        throw new Error(`${failedUploadCount} 张照片上传失败，请稍后重试。`);
      }
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects"], exact: true }),
      queryClient.invalidateQueries({ queryKey: ["projects", project.id], exact: true }),
      queryClient.invalidateQueries({
        queryKey: ["projects", project.id, "photos"],
        exact: true
      })
    ]);

    if (formRevisionRef.current === revisionAtStart) {
      setSaveStatus("saved");
    }
    return project;
  };

  const runDraftSync = async (): Promise<ProjectDetail | null> => {
    if (syncRunningRef.current) {
      syncQueuedRef.current = true;
      return syncPromiseRef.current;
    }

    syncRunningRef.current = true;
    const syncPromise = (async () => {
      do {
        syncQueuedRef.current = false;
        await syncDraftOnce();
      } while (syncQueuedRef.current);
      return savedProjectRef.current;
    })();
    syncPromiseRef.current = syncPromise;

    try {
      return await syncPromise;
    } catch (error) {
      setSaveStatus("error");
      setSaveError(getErrorMessage(error));
      throw error;
    } finally {
      syncRunningRef.current = false;
      syncPromiseRef.current = null;
    }
  };

  const scheduleDraftSync = () => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    setSaveStatus("saving");
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void runDraftSync().catch(() => undefined);
    }, PROJECT_AUTO_SAVE_DELAY_MS);
  };

  const field = (name: "name", value: string) => {
    replaceForm({ ...formRef.current, [name]: value });
    formRevisionRef.current += 1;
    setFormError("");
    setSaveError("");
    if (savedProjectRef.current || syncRunningRef.current) {
      scheduleDraftSync();
    } else {
      setSaveStatus("idle");
    }
  };

  const applyFiles = (files: File[]) => {
    if (!files.length || startDetectionPending) return;

    const rejectionMessages: string[] = [];
    const validFiles = files.filter((file) => {
      const message = validatePhotoUpload(file, { maxSizeBytes: MAX_PROJECT_PHOTO_SIZE_BYTES });
      if (!message) return true;
      rejectionMessages.push(`${file.name}：${message}`);
      return false;
    });
    if (!validFiles.length) {
      setPhotoError(rejectionMessages[0] ?? "未选择可上传的图片。");
      return;
    }

    const remainingSlots = MAX_PROJECT_PHOTO_COUNT - formRef.current.photos.length;
    if (remainingSlots <= 0) {
      setPhotoError(`每个项目最多上传 ${MAX_PROJECT_PHOTO_COUNT} 张照片。`);
      return;
    }
    const acceptedFiles = validFiles.slice(0, remainingSlots);
    if (acceptedFiles.length < validFiles.length) {
      rejectionMessages.unshift(
        `每个项目最多上传 ${MAX_PROJECT_PHOTO_COUNT} 张照片，已添加前 ${remainingSlots} 张。`
      );
    }

    const pendingPhotos = acceptedFiles.map((file): PendingPhoto => {
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      return {
        localId: createClientId("project-photo"),
        file,
        previewUrl,
        status: "pending"
      };
    });
    const nextForm: ProjectDraft = {
      ...formRef.current,
      photos: [...formRef.current.photos, ...pendingPhotos]
    };
    replaceForm(nextForm);
    formRevisionRef.current += 1;

    setPhotoError(rejectionMessages[0] ?? "");
    setSaveError("");
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    void runDraftSync().catch(() => undefined);
  };

  const finalizePendingPhotoRemoval = async (): Promise<boolean> => {
    const removal = removedPhotoRef.current;
    if (!removal) return true;
    if (photoDeleteTimerRef.current !== null) {
      window.clearTimeout(photoDeleteTimerRef.current);
      photoDeleteTimerRef.current = null;
    }
    removedPhotoRef.current = null;
    setRecentlyRemovedPhoto(null);
    if (!removal.photo.remoteId) {
      URL.revokeObjectURL(removal.photo.previewUrl);
      previewUrlsRef.current.delete(removal.photo.previewUrl);
      return true;
    }

    setSaveStatus("saving");
    setSaveError("");
    try {
      await deletePhoto(removal.photo.remoteId);
      URL.revokeObjectURL(removal.photo.previewUrl);
      previewUrlsRef.current.delete(removal.photo.previewUrl);
      const projectId = savedProjectRef.current?.id;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"], exact: true }),
        ...(projectId ? [
          queryClient.invalidateQueries({
            queryKey: ["projects", projectId, "photos"],
            exact: true
          })
        ] : [])
      ]);
      setSaveStatus("saved");
      return true;
    } catch (error) {
      const nextPhotos = [...formRef.current.photos];
      nextPhotos.splice(Math.min(removal.index, nextPhotos.length), 0, removal.photo);
      replaceForm({ ...formRef.current, photos: nextPhotos });
      formRevisionRef.current += 1;
      setSaveStatus("error");
      setSaveError(`${getErrorMessage(error)}，照片已恢复。`);
      return false;
    }
  };

  const removePendingPhoto = (photoId: string) => {
    const removedPhoto = formRef.current.photos.find((photo) => photo.localId === photoId);
    if (!removedPhoto || saveStatus === "saving" || startDetectionPending) return;

    const index = formRef.current.photos.findIndex((photo) => photo.localId === photoId);
    if (index < 0) return;
    void finalizePendingPhotoRemoval();
    const removal = { index, photo: removedPhoto };
    removedPhotoRef.current = removal;
    setRecentlyRemovedPhoto(removal);
    replaceForm({
      ...formRef.current,
      photos: formRef.current.photos.filter((photo) => photo.localId !== photoId)
    });
    formRevisionRef.current += 1;
    setSaveError("");
    setPhotoError("");
    photoDeleteTimerRef.current = window.setTimeout(() => {
      void finalizePendingPhotoRemoval();
    }, PHOTO_DELETE_UNDO_MILLISECONDS);
  };

  const undoPhotoRemoval = () => {
    const removal = removedPhotoRef.current;
    if (!removal) return;
    if (photoDeleteTimerRef.current !== null) {
      window.clearTimeout(photoDeleteTimerRef.current);
      photoDeleteTimerRef.current = null;
    }
    removedPhotoRef.current = null;
    setRecentlyRemovedPhoto(null);
    const nextPhotos = [...formRef.current.photos];
    nextPhotos.splice(Math.min(removal.index, nextPhotos.length), 0, removal.photo);
    replaceForm({ ...formRef.current, photos: nextPhotos });
    formRevisionRef.current += 1;
  };

  const flushDraftSync = () => {
    if (!savedProjectRef.current) return;
    if (saveStatus !== "saving" && saveStatus !== "error") return;
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    void runDraftSync().catch(() => undefined);
  };

  const startDetection = async () => {
    if (!formRef.current.photos.length) {
      setFormError("请至少上传一张照片后再开始 AI 检测。");
      return;
    }
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    setFormError("");
    setStartDetectionPending(true);
    try {
      if (!(await finalizePendingPhotoRemoval())) return;
      const project = await runDraftSync();
      const uploadedPhotoCount = formRef.current.photos.filter((photo) => photo.remoteId).length;
      if (!project || !uploadedPhotoCount) {
        throw new Error("照片尚未保存完成，请稍后重试。");
      }
      navigate(`/detections/${project.id}`, {
        state: { openDetectionModal: true }
      });
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setStartDetectionPending(false);
    }
  };

  const isSaving = saveStatus === "saving";
  const totalPhotoCount = form.photos.length;
  const uploadedPhotoCount = form.photos.filter((photo) => photo.status === "saved").length;
  const failedPhotoCount = form.photos.filter((photo) => photo.status === "failed").length;
  const activePhotoUploadCount = form.photos.filter(
    (photo) => photo.status === "pending" || photo.status === "uploading"
  ).length;
  const photoUploadProgress = totalPhotoCount
    ? Math.round(uploadedPhotoCount / totalPhotoCount * 100)
    : 0;
  const allPhotosUploaded = totalPhotoCount > 0 && uploadedPhotoCount === totalPhotoCount;

  return (
    <DetectionCreateWorkbench
      ariaLabel="新建专业检测"
      title="新增检测项目"
      guideDescription={(
        <>支持<span className="trial-defect-types">裂缝、剥落、空鼓</span>外墙缺陷识别</>
      )}
      nameField={(
        <Label label="检测名称">
          <input
            value={form.name}
            placeholder="请输入检测名称"
            onBlur={flushDraftSync}
            onChange={(event) => field("name", event.target.value)}
          />
        </Label>
      )}
      nameActions={(
        <>
          <Link
            className="button secondary report-back-button project-workbench-nav-button new-project-back-button"
            to="/detections"
          >
            <ArrowLeft aria-hidden="true" />
            返回
          </Link>
          <button
            className="button primary start-ai-detection-button"
            disabled={startDetectionPending}
            type="button"
            onClick={() => void startDetection()}
          >
            <Send aria-hidden="true" />
            {startDetectionPending ? "正在准备…" : "开始AI检测"}
          </button>
        </>
      )}
      photoHeadingStatus={(
        <>
          {activePhotoUploadCount ? (
            <div className="new-project-upload-overview" role="status" aria-live="polite">
              <span>正在上传，已完成 {uploadedPhotoCount}/{totalPhotoCount}</span>
              <span
                aria-label={`照片上传进度 ${photoUploadProgress}%`}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={photoUploadProgress}
                className="new-project-upload-track"
                role="progressbar"
              >
                <i style={{ width: `${photoUploadProgress}%` }} />
              </span>
            </div>
          ) : failedPhotoCount ? (
            <span className="new-project-upload-summary is-error">{failedPhotoCount} 张上传失败</span>
          ) : allPhotosUploaded ? (
            <span className="new-project-upload-summary is-complete">上传完成</span>
          ) : null}
          <span className="new-project-photo-count">{totalPhotoCount} 张</span>
        </>
      )}
      photoUploader={(
        <>
          <ProjectPhotoUploader
            addDisabled={startDetectionPending || form.photos.length >= MAX_PROJECT_PHOTO_COUNT}
            disabled={startDetectionPending}
            emptyHint={<span className="professional-drone-upload-hint">（仅支持专业无人机拍摄的照片）</span>}
            hasPhotos={Boolean(form.photos.length)}
            onFilesSelected={applyFiles}
          >
            {form.photos.map((photo) => {
              const thermalAvailable = photo.status === "saved" && photo.photoType === "thermal";
              return (
                <PhotoUploadThumbnail
                  badges={thermalAvailable ? <span className="trial-thermal-available-tag">热成像</span> : null}
                  fileName={photo.file.name}
                  key={photo.localId}
                  precheckCategory={photo.precheckCategory}
                  precheckReason={photo.precheckReason}
                  precheckStatus={photo.precheckStatus}
                  previewUrl={photo.previewUrl}
                  removeDisabled={isSaving || startDetectionPending}
                  statusClassName={`is-${photo.status}`}
                  onRemove={() => void removePendingPhoto(photo.localId)}
                >
                  {photo.status === "pending" || photo.status === "uploading" ? (
                    <span
                      aria-label={`${photo.file.name}${photo.status === "pending" ? "等待上传" : "正在上传"}`}
                      className="new-project-photo-upload-indicator"
                      role="status"
                    >
                      <span aria-hidden="true" className="new-project-photo-upload-ring" />
                      <small>{photo.status === "pending" ? "等待上传" : "上传中"}</small>
                    </span>
                  ) : null}
                </PhotoUploadThumbnail>
              );
            })}
          </ProjectPhotoUploader>
          {photoError ? <p className="project-photo-error">{photoError}</p> : null}
        </>
      )}
      feedback={(
        <>
          {(formError || saveError) ? <p className="create-form-error">{formError || saveError}</p> : null}
          {recentlyRemovedPhoto ? (
            <p className="trial-undo-message" role="status">
              已移除“{recentlyRemovedPhoto.photo.file.name}”
              <button type="button" onClick={undoPhotoRemoval}>撤销</button>
            </p>
          ) : null}
        </>
      )}
    />
  );
}

function Label({
  label,
  required,
  className = "",
  children
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`form-field ${className}`}>
      <span>{label}：{required ? <b>*</b> : null}</span>
      {children}
    </label>
  );
}
