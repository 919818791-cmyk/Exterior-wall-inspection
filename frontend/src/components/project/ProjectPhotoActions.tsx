import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImageOff, RefreshCcw, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";

import {
  createUploadBatch,
  deletePhoto,
  projectPhotosQueryOptions,
  uploadPhoto
} from "@/api/projects";
import { ProjectPhotoUploader } from "@/components/project/ProjectPhotoUploader";
import type { Photo, ProjectDetail } from "@/types/projects";
import { createAsyncLimiter } from "@/utils/asyncLimiter";
import { createClientId } from "@/utils/id";

const ACCEPTED_PHOTO_TYPES = new Set(["image/jpeg", "image/png"]);
const runFormalPhotoUpload = createAsyncLimiter(6);
const PHOTO_PREVIEW_DEFAULT_ZOOM = 1;
const PHOTO_PREVIEW_MIN_ZOOM = 1;
const PHOTO_PREVIEW_MAX_ZOOM = 4;
const PHOTO_PREVIEW_ZOOM_STEP = 0.25;

type PendingUploadStatus = "uploading" | "uploaded" | "failed";

interface PendingUpload {
  id: string;
  file: File;
  previewUrl: string;
  status: PendingUploadStatus;
  error?: string;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function validatePhoto(file: File) {
  if (!ACCEPTED_PHOTO_TYPES.has(file.type)) return "图片格式不支持。";
  if (!file.size) return "图片内容为空。";
  return "";
}

export function ProjectPhotoActions({
  isEditable,
  project
}: {
  isEditable: boolean;
  project: ProjectDetail;
}) {
  const pendingUploadsRef = useRef<PendingUpload[]>([]);
  const uploaderRef = useRef<HTMLDivElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const previewDragRef = useRef<{ pointerId: number; x: number; y: number; distance: number } | null>(null);
  const previewDragMovedRef = useRef(false);
  const queryClient = useQueryClient();
  const photosQuery = useQuery({
    ...projectPhotosQueryOptions(project.id),
    refetchInterval: (query) => {
      const photos = query.state.data as Photo[] | undefined;
      return photos?.some((photo) => (
        photo.precheck_status === "pending" || photo.precheck_status === "running"
      )) ? 1500 : false;
    }
  });
  const projectPhotos = useMemo(
    () => [...(photosQuery.data ?? [])].sort((left, right) => (
      Date.parse(left.created_at) - Date.parse(right.created_at)
      || left.id.localeCompare(right.id)
    )),
    [photosQuery.data]
  );
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [previewPhotoId, setPreviewPhotoId] = useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = useState(PHOTO_PREVIEW_DEFAULT_ZOOM);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [localError, setLocalError] = useState("");

  const previewPhoto = projectPhotos.find((photo) => photo.id === previewPhotoId) ?? null;
  const previewPhotoUrl = previewPhoto?.preview_url ?? previewPhoto?.thumbnail_url ?? "";
  const hasPhotos = Boolean(projectPhotos.length || pendingUploads.length);
  const uploadedPendingCount = pendingUploads.filter((item) => item.status === "uploaded").length;
  const failedPendingCount = pendingUploads.filter((item) => item.status === "failed").length;
  const activePendingCount = pendingUploads.filter((item) => item.status === "uploading").length;
  const visiblePhotoCount = projectPhotos.length + pendingUploads.length;
  const uploadPercent = pendingUploads.length
    ? Math.round((uploadedPendingCount / pendingUploads.length) * 100)
    : 0;

  const setTrackedPendingUploads = (
    updater: PendingUpload[] | ((current: PendingUpload[]) => PendingUpload[])
  ) => {
    setPendingUploads((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      pendingUploadsRef.current = next;
      return next;
    });
  };

  const updatePendingUpload = (
    id: string,
    update: Partial<Pick<PendingUpload, "status" | "error">>
  ) => {
    setTrackedPendingUploads((current) => current.map((item) => (
      item.id === id ? { ...item, ...update } : item
    )));
  };

  const invalidatePhotos = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["projects", project.id] }),
      queryClient.invalidateQueries({ queryKey: ["projects", project.id, "photos"] })
    ]);
  };

  const uploadMutation = useMutation({
    mutationFn: async (entries: PendingUpload[]) => {
      const batch = await createUploadBatch(project.id, {
        drone_type: "大疆型号",
        remark: null,
        upload_mode: "dji"
      });
      const failures: Array<{ id: string; error: string }> = [];

      await Promise.all(entries.map(async (entry) => {
        updatePendingUpload(entry.id, { status: "uploading", error: undefined });
        try {
          const formData = new FormData();
          formData.append("project_id", project.id);
          formData.append("upload_batch_id", batch.id);
          formData.append("photo_type", "dji");
          formData.append("file", entry.file);
          await runFormalPhotoUpload(() => uploadPhoto(formData));
          updatePendingUpload(entry.id, { status: "uploaded", error: undefined });
        } catch (error) {
          const message = getErrorMessage(error);
          failures.push({ id: entry.id, error: message });
          updatePendingUpload(entry.id, { status: "failed", error: message });
        }
      }));

      return failures;
    },
    onSuccess: async (failures, entries) => {
      await invalidatePhotos();
      const entryIds = new Set(entries.map((item) => item.id));
      const failureById = new Map(failures.map((item) => [item.id, item.error]));
      setTrackedPendingUploads((current) => {
        const next = current
          .filter((item) => !entryIds.has(item.id) || failureById.has(item.id))
          .map((item) => ({
            ...item,
            status: failureById.has(item.id) ? "failed" as const : item.status,
            error: failureById.get(item.id) ?? item.error
          }));
        current
          .filter((item) => entryIds.has(item.id) && !failureById.has(item.id))
          .forEach((item) => URL.revokeObjectURL(item.previewUrl));
        return next;
      });
      setLocalError(failures.length ? `${failures.length} 张图片上传失败，可点击下方按钮重试。` : "");
    },
    onError: (error, entries) => {
      const message = getErrorMessage(error);
      const entryIds = new Set(entries.map((item) => item.id));
      setTrackedPendingUploads((current) => current.map((item) => (
        entryIds.has(item.id) ? { ...item, status: "failed", error: message } : item
      )));
      setLocalError(message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deletePhoto,
    onSuccess: async (_, deletedPhotoId) => {
      if (previewPhotoId === deletedPhotoId) closePhotoPreview();
      await invalidatePhotos();
    }
  });

  useEffect(() => {
    if (!previewPhotoId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePhotoPreview();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewPhotoId]);

  useEffect(() => () => {
    pendingUploadsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const uploader = uploaderRef.current;
      if (uploader) uploader.scrollTop = uploader.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingUploads.length, projectPhotos.length]);

  const startUploads = (entries: PendingUpload[]) => {
    if (!entries.length || !isEditable || uploadMutation.isPending) return;
    setLocalError("");
    uploadMutation.mutate(entries);
  };

  const applyFiles = (files: File[]) => {
    if (!files.length || !isEditable || uploadMutation.isPending) return;

    const rejectionMessages: string[] = [];
    const validFiles = files.filter((file) => {
      const message = validatePhoto(file);
      if (!message) return true;
      rejectionMessages.push(`${file.name}：${message}`);
      return false;
    });
    if (!validFiles.length) {
      setLocalError(rejectionMessages[0] ?? "未选择可上传的图片。");
      return;
    }

    const entries = validFiles.map((file): PendingUpload => ({
      id: createClientId("project-photo"),
      file,
      previewUrl: URL.createObjectURL(file),
      status: "uploading"
    }));
    setTrackedPendingUploads((current) => [...current, ...entries]);

    setLocalError(rejectionMessages[0] ?? "");
    startUploads(entries);
  };

  function resetPhotoPreviewTransform() {
    previewDragRef.current = null;
    previewDragMovedRef.current = false;
    setPreviewZoom(PHOTO_PREVIEW_DEFAULT_ZOOM);
    setPreviewPan({ x: 0, y: 0 });
  }

  function openPhotoPreview(photoId: string) {
    resetPhotoPreviewTransform();
    setPreviewPhotoId(photoId);
  }

  function closePhotoPreview() {
    setPreviewPhotoId(null);
    resetPhotoPreviewTransform();
  }

  function clampPreviewPan(pan: { x: number; y: number }, zoom: number) {
    const viewport = previewViewportRef.current;
    if (!viewport || zoom <= PHOTO_PREVIEW_DEFAULT_ZOOM) return { x: 0, y: 0 };
    const maxX = (viewport.clientWidth * (zoom - 1)) / 2;
    const maxY = (viewport.clientHeight * (zoom - 1)) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, pan.x)),
      y: Math.max(-maxY, Math.min(maxY, pan.y))
    };
  }

  function updatePhotoPreviewZoom(nextZoom: number) {
    const zoom = Math.max(PHOTO_PREVIEW_MIN_ZOOM, Math.min(PHOTO_PREVIEW_MAX_ZOOM, nextZoom));
    setPreviewZoom(zoom);
    setPreviewPan((current) => clampPreviewPan(current, zoom));
  }

  function zoomPhotoPreviewBy(delta: number) {
    updatePhotoPreviewZoom(previewZoom + delta);
  }

  function handlePhotoPreviewWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    zoomPhotoPreviewBy(event.deltaY < 0 ? PHOTO_PREVIEW_ZOOM_STEP : -PHOTO_PREVIEW_ZOOM_STEP);
  }

  function startPhotoPreviewDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (previewZoom <= PHOTO_PREVIEW_DEFAULT_ZOOM || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    previewDragMovedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    previewDragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      distance: 0
    };
  }

  function movePhotoPreview(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = previewDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    const distance = drag.distance + Math.abs(deltaX) + Math.abs(deltaY);
    if (distance >= 3) previewDragMovedRef.current = true;
    previewDragRef.current = { ...drag, x: event.clientX, y: event.clientY, distance };
    setPreviewPan((current) => clampPreviewPan({
      x: current.x + deltaX,
      y: current.y + deltaY
    }, previewZoom));
  }

  function stopPhotoPreviewDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (previewDragRef.current?.pointerId !== event.pointerId) return;
    previewDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    window.setTimeout(() => { previewDragMovedRef.current = false; }, 0);
  }

  function handlePhotoPreviewBackdropClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (previewDragMovedRef.current) return;
    const target = event.target;
    if (
      target instanceof Element
      && target.closest(".trial-photo-preview-close, .trial-photo-preview-toolbar, .trial-photo-preview-content, .trial-photo-preview-caption")
    ) return;
    closePhotoPreview();
  }

  const retryFailedUploads = () => {
    startUploads(pendingUploads.filter((item) => item.status === "failed"));
  };

  const removePhoto = (photoId: string) => {
    if (!isEditable || deleteMutation.isPending) return;
    deleteMutation.mutate(photoId);
  };

  const activeError = localError
    || (photosQuery.isError ? getErrorMessage(photosQuery.error) : "")
    || (deleteMutation.isError ? getErrorMessage(deleteMutation.error) : "");

  return (
    <>
      <header className="project-photo-workspace-heading">
        <h2 id="project-photo-title">检测照片</h2>
        <div className="new-project-photo-heading-status">
          {activePendingCount ? (
            <div className="new-project-upload-overview" role="status" aria-live="polite">
              <span>正在上传，已完成 {uploadedPendingCount}/{pendingUploads.length}</span>
              <span
                aria-label={`照片上传进度 ${uploadPercent}%`}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={uploadPercent}
                className="new-project-upload-track"
                role="progressbar"
              >
                <i style={{ width: `${uploadPercent}%` }} />
              </span>
            </div>
          ) : failedPendingCount ? (
            <button
              className="new-project-upload-summary is-error detail-photo-upload-retry"
              type="button"
              onClick={retryFailedUploads}
            >
              <RefreshCcw aria-hidden="true" />{failedPendingCount} 张失败，重试
            </button>
          ) : visiblePhotoCount ? (
            <span className="new-project-upload-summary is-complete">上传完成</span>
          ) : null}
          <span className="new-project-photo-count">{visiblePhotoCount} 张</span>
        </div>
      </header>
      <ProjectPhotoUploader
        containerRef={uploaderRef}
        disabled={!isEditable || uploadMutation.isPending}
        hasPhotos={hasPhotos}
        isLoading={photosQuery.isLoading}
        onFilesSelected={applyFiles}
      >
        {projectPhotos.map((photo) => {
          const previewUrl = photo.thumbnail_url ?? photo.preview_url;
          const hasPrecheckIssue = photo.precheck_status === "rejected" || photo.precheck_status === "error";
          const precheckDetail = photo.precheck_error ?? photo.precheck_reason
            ?? (photo.precheck_status === "rejected" ? "建筑判断未通过" : "建筑判断异常");
          return (
            <figure className={`project-photo-thumb is-uploaded precheck-${photo.precheck_status}`} key={photo.id}>
              <div
                className="project-photo-thumb-image"
                aria-label={previewUrl ? `放大查看 ${photo.original_filename}` : undefined}
                role={previewUrl ? "button" : undefined}
                tabIndex={previewUrl ? 0 : undefined}
                onClick={(event) => {
                  if (!previewUrl || (event.target instanceof Element && event.target.closest("button"))) return;
                  openPhotoPreview(photo.id);
                }}
                onKeyDown={(event) => {
                  if (previewUrl && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    openPhotoPreview(photo.id);
                  }
                }}
              >
                {previewUrl
                  ? <img alt={photo.original_filename} src={previewUrl} />
                  : <span className="project-photo-missing"><ImageOff aria-hidden="true" /></span>}
                {hasPrecheckIssue ? (
                  <span
                    aria-label={`${photo.original_filename}：${precheckDetail}`}
                    className="project-photo-precheck-alert is-issue"
                    title={precheckDetail}
                  >
                    !
                  </span>
                ) : null}
                <div className="project-photo-thumb-actions">
                  <button aria-label={`放大查看 ${photo.original_filename}`} disabled={!previewUrl} title="放大查看" type="button" onClick={() => openPhotoPreview(photo.id)}><ZoomIn aria-hidden="true" /></button>
                  <button aria-label={`删除 ${photo.original_filename}`} className="danger" disabled={!isEditable || deleteMutation.isPending} title="删除" type="button" onClick={() => removePhoto(photo.id)}><Trash2 aria-hidden="true" /></button>
                </div>
              </div>
              <figcaption>{photo.original_filename}</figcaption>
            </figure>
          );
        })}
        {pendingUploads.map((item) => (
          <figure className={`project-photo-thumb is-${item.status}`} key={item.id}>
            <div className="project-photo-thumb-image">
              <img alt={item.file.name} src={item.previewUrl} />
              {item.status === "uploading" ? (
                <span
                  aria-label={`${item.file.name}正在上传`}
                  className="new-project-photo-upload-indicator"
                  role="status"
                >
                  <span aria-hidden="true" className="new-project-photo-upload-ring" />
                  <small>上传中</small>
                </span>
              ) : item.status === "uploaded" ? (
                <span className="project-photo-check"><Check aria-hidden="true" /></span>
              ) : null}
            </div>
            <figcaption>{item.file.name}</figcaption>
            {item.status === "failed" ? <span className="project-photo-upload-status">上传失败</span> : null}
          </figure>
        ))}
      </ProjectPhotoUploader>

      {activeError ? <p className="project-photo-error">{activeError}</p> : null}

      {previewPhoto && previewPhotoUrl ? createPortal(
        <div
          className="trial-photo-preview-modal"
          role="dialog"
          aria-modal="true"
          aria-label="照片预览"
          onClick={handlePhotoPreviewBackdropClick}
        >
          <figure>
            <button
              className="trial-photo-preview-close"
              type="button"
              aria-label="关闭照片预览"
              onClick={closePhotoPreview}
            >
              <X aria-hidden="true" />
            </button>
            <div className="trial-photo-preview-toolbar" aria-label="照片缩放控制">
              <button
                type="button"
                aria-label="缩小照片"
                disabled={previewZoom <= PHOTO_PREVIEW_MIN_ZOOM}
                onClick={() => zoomPhotoPreviewBy(-PHOTO_PREVIEW_ZOOM_STEP)}
              >
                <ZoomOut aria-hidden="true" />
              </button>
              <output aria-live="polite">{Math.round(previewZoom * 100)}%</output>
              <button
                type="button"
                aria-label="放大照片"
                disabled={previewZoom >= PHOTO_PREVIEW_MAX_ZOOM}
                onClick={() => zoomPhotoPreviewBy(PHOTO_PREVIEW_ZOOM_STEP)}
              >
                <ZoomIn aria-hidden="true" />
              </button>
              <button type="button" aria-label="恢复照片原始大小" onClick={resetPhotoPreviewTransform}>
                <RefreshCcw aria-hidden="true" />
              </button>
            </div>
            <div
              ref={previewViewportRef}
              className={`trial-photo-preview-viewport ${previewZoom > PHOTO_PREVIEW_DEFAULT_ZOOM ? "is-draggable" : ""}`}
              onWheel={handlePhotoPreviewWheel}
              onPointerDown={startPhotoPreviewDrag}
              onPointerMove={movePhotoPreview}
              onPointerUp={stopPhotoPreviewDrag}
              onPointerCancel={stopPhotoPreviewDrag}
              onLostPointerCapture={() => { previewDragRef.current = null; }}
            >
              <div
                className="trial-photo-preview-content"
                style={{ transform: `translate3d(${previewPan.x}px, ${previewPan.y}px, 0) scale(${previewZoom})` }}
              >
                <img draggable={false} alt={previewPhoto.original_filename} src={previewPhotoUrl} />
              </div>
            </div>
            <figcaption className="trial-photo-preview-caption">
              {previewPhoto.original_filename}
            </figcaption>
          </figure>
        </div>,
        document.body
      ) : null}
    </>
  );
}
