import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send, X } from "lucide-react";
import {
  type FormEvent,
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
import { ProjectPhotoUploader } from "@/components/project/ProjectPhotoUploader";
import { ProjectWorkbenchShell } from "@/components/project/ProjectWorkbenchShell";
import type { ProjectCreatePayload, ProjectDetail } from "@/types/projects";
import { createClientId } from "@/utils/id";
import { PROJECT_STATUS_LABELS } from "@/utils/projectDisplay";

const ACCEPTED_PHOTO_TYPES = new Set(["image/jpeg", "image/png"]);

interface PendingPhoto {
  localId: string;
  file: File;
  previewUrl: string;
  remoteId?: string;
  status: "pending" | "uploading" | "saved" | "failed";
}

interface ProjectDraft {
  name: string;
  address: string;
  longitude: string;
  latitude: string;
  photos: PendingPhoto[];
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

const PROJECT_AUTO_SAVE_DELAY_MS = 600;

function createInitialProject(): ProjectDraft {
  return {
    name: "",
    address: "",
    longitude: "",
    latitude: "",
    photos: []
  };
}

const cleanText = (value: string) => value.trim() || null;
const cleanDecimal = (value: string) => value.trim() || null;

function toPayload(form: ProjectDraft): { payload: ProjectCreatePayload | null; error: string } {
  return {
    error: "",
    payload: {
      name: cleanText(form.name),
      address: cleanText(form.address),
      longitude: cleanDecimal(form.longitude),
      latitude: cleanDecimal(form.latitude)
    }
  };
}

function validatePhoto(file: File) {
  if (!ACCEPTED_PHOTO_TYPES.has(file.type)) return "图片格式不支持。";
  if (!file.size) return "图片内容为空。";
  return "";
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
  const [formError, setFormError] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [startDetectionPending, setStartDetectionPending] = useState(false);

  useEffect(() => () => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
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
    update: Partial<Pick<PendingPhoto, "remoteId" | "status">>
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
    setSaveMessage(savedProjectRef.current ? "正在自动保存…" : "正在创建项目…");
    setSaveError("");

    let project = savedProjectRef.current;
    if (project) {
      project = await updateProject(project.id, {
        name: result.payload.name,
        address: result.payload.address,
        longitude: result.payload.longitude,
        latitude: result.payload.latitude
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
      setSaveMessage("正在上传照片…");
      photosToUpload.forEach((photo) => updatePhoto(photo.localId, { status: "uploading" }));
      let batch;
      try {
        batch = await createUploadBatch(project.id, {
          drone_type: "大疆型号",
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
      setSaveMessage("已保存");
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
      setSaveMessage("保存失败");
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
    setSaveMessage("正在自动保存…");
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void runDraftSync().catch(() => undefined);
    }, PROJECT_AUTO_SAVE_DELAY_MS);
  };

  const field = (name: keyof Omit<ProjectDraft, "photos">, value: string) => {
    replaceForm({ ...formRef.current, [name]: value });
    formRevisionRef.current += 1;
    setFormError("");
    setSaveError("");
    if (savedProjectRef.current || syncRunningRef.current) {
      scheduleDraftSync();
    } else {
      setSaveStatus("idle");
      setSaveMessage("");
    }
  };

  const applyFiles = (files: File[]) => {
    if (!files.length || startDetectionPending) return;

    const rejectionMessages: string[] = [];
    const validFiles = files.filter((file) => {
      const message = validatePhoto(file);
      if (!message) return true;
      rejectionMessages.push(`${file.name}：${message}`);
      return false;
    });
    if (!validFiles.length) {
      setPhotoError(rejectionMessages[0] ?? "未选择可上传的图片。");
      return;
    }

    const pendingPhotos = validFiles.map((file): PendingPhoto => {
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

  const removePendingPhoto = async (photoId: string) => {
    const removedPhoto = formRef.current.photos.find((photo) => photo.localId === photoId);
    if (!removedPhoto || saveStatus === "saving" || startDetectionPending) return;

    setSaveStatus("saving");
    setSaveMessage("正在自动保存…");
    setSaveError("");
    try {
      if (removedPhoto.remoteId) {
        await deletePhoto(removedPhoto.remoteId);
      }
      URL.revokeObjectURL(removedPhoto.previewUrl);
      previewUrlsRef.current.delete(removedPhoto.previewUrl);
      replaceForm({
        ...formRef.current,
        photos: formRef.current.photos.filter((photo) => photo.localId !== photoId)
      });
      formRevisionRef.current += 1;
      if (savedProjectRef.current) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["projects"], exact: true }),
          queryClient.invalidateQueries({
            queryKey: ["projects", savedProjectRef.current.id, "photos"],
            exact: true
          })
        ]);
        setSaveStatus("saved");
        setSaveMessage("已保存");
      } else {
        setSaveStatus("idle");
        setSaveMessage("");
      }
    } catch (error) {
      setSaveStatus("error");
      setSaveMessage("保存失败");
      setSaveError(getErrorMessage(error));
    }
    setPhotoError("");
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

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
      const project = await runDraftSync();
      const uploadedPhotoCount = formRef.current.photos.filter((photo) => photo.remoteId).length;
      if (!project || !uploadedPhotoCount) {
        throw new Error("照片尚未保存完成，请稍后重试。");
      }
      navigate(`/projects/${project.id}`, {
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
    <ProjectWorkbenchShell actionLabel="返回" hideHeader>
      <form className="create-workspace" onSubmit={handleSubmit}>
        <h1 className="sr-only">新增检测项目</h1>
        <section className="project-editor-panel" aria-label="新建项目">
          <div className="project-editor-block project-fields project-editor-basic-fields">
            <Label label="项目编号">
              <input readOnly value="自动生成" />
            </Label>
            <Label label="项目状态">
              <input readOnly value={PROJECT_STATUS_LABELS.draft} />
            </Label>
            <Label label="项目名称">
              <input
                value={form.name}
                placeholder="请输入项目名称"
                onBlur={flushDraftSync}
                onChange={(event) => field("name", event.target.value)}
              />
            </Label>
            <Label label="项目位置">
              <input
                value={form.address}
                placeholder="请输入详细地址"
                onBlur={flushDraftSync}
                onChange={(event) => field("address", event.target.value)}
              />
            </Label>
          </div>

          <div className="project-editor-block project-editor-photo-block">
            <section className="project-photo-workspace" aria-labelledby="new-project-photo-title">
              <header className="project-photo-workspace-heading">
                <h2 id="new-project-photo-title">检测照片</h2>
                <div className="new-project-photo-heading-status">
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
                </div>
              </header>
              <ProjectPhotoUploader
                addDisabled={startDetectionPending}
                disabled={startDetectionPending}
                hasPhotos={Boolean(form.photos.length)}
                onFilesSelected={applyFiles}
              >
                {form.photos.map((photo) => (
                  <figure className={`project-photo-thumb is-${photo.status}`} key={photo.localId}>
                    <div className="project-photo-thumb-image">
                      <img alt={photo.file.name} src={photo.previewUrl} />
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
                      <button
                        aria-label={`移除 ${photo.file.name}`}
                        className="new-project-photo-remove"
                        disabled={isSaving || startDetectionPending}
                        title="移除"
                        type="button"
                        onClick={() => void removePendingPhoto(photo.localId)}
                      >
                        <X aria-hidden="true" />
                      </button>
                    </div>
                    <figcaption>{photo.file.name}</figcaption>
                  </figure>
                ))}
              </ProjectPhotoUploader>
              {photoError ? <p className="project-photo-error">{photoError}</p> : null}
            </section>
          </div>

          <div className="create-action-bar new-project-action-bar">
            {(formError || saveError) ? (
              <p className="create-form-error">{formError || saveError}</p>
            ) : null}
            <div>
              {saveMessage ? (
                <span
                  className={`new-project-save-status is-${saveStatus}`}
                  role="status"
                >
                  {saveMessage}
                </span>
              ) : null}
              <Link
                className="button secondary report-back-button project-workbench-nav-button new-project-back-button"
                to="/projects"
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
                {startDetectionPending
                  ? "正在准备…"
                  : "开始AI检测"}
              </button>
            </div>
          </div>
        </section>
      </form>
    </ProjectWorkbenchShell>
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
