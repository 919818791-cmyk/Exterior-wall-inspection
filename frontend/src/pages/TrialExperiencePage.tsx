import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from "@heroui/react";
import {
  ArrowLeft,
  Check,
  CircleCheckBig,
  Home,
  Images,
  LoaderCircle,
  RefreshCcw,
  ScanSearch,
  Send,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { Link, useBeforeUnload, useBlocker, useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import {
  archiveTrialResult,
  deleteTrialPhoto,
  generateTrialResult,
  getTrialRequestStatus,
  updateTrialReportTitle,
  uploadTrialPhoto as uploadTrialPhotoFile,
  type TrialGeneratedResult,
  type TrialUploadedPhoto
} from "@/api/reports";
import { PhotoUploadThumbnail } from "@/components/project/PhotoUploadThumbnail";
import { DetectionGuidePanel } from "@/components/project/DetectionCreateWorkbench";
import { ProjectPhotoUploader } from "@/components/project/ProjectPhotoUploader";
import { ProjectWorkbenchShell } from "@/components/project/ProjectWorkbenchShell";
import { StartDetectionModal } from "@/components/project/StartDetectionModal";
import { useAuthStore } from "@/stores/useAuthStore";
import type { StartDetectionPayload } from "@/types/projects";
import { createAsyncLimiter } from "@/utils/asyncLimiter";
import { createClientId } from "@/utils/id";
import { validatePhotoUpload } from "@/utils/photoUpload";
import { trialDefectBoxLabel, trialDefectDisplayFromModel } from "@/utils/trialDefectDisplay";
import { readTrialPhotoMetadata, type TrialPhotoMetadata } from "@/utils/photoMetadata";

const MODEL_OPTIONS = ["裂缝", "剥落", "空鼓"] as const;
const MAX_TRIAL_PHOTO_COUNT = 30;
const MAX_TRIAL_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;
const TRIAL_RESULT_CONFIDENCE_THRESHOLD = 0.6;
const PHOTO_PREVIEW_DEFAULT_ZOOM = 1;
const PHOTO_PREVIEW_MIN_ZOOM = 1;
const PHOTO_PREVIEW_MAX_ZOOM = 4;
const PHOTO_PREVIEW_ZOOM_STEP = 0.25;
const runTrialPhotoUpload = createAsyncLimiter(6);
const UPLOAD_LIMIT_TIP = "支持 JPG、PNG 图片，单张最大 5MB；单次最多 30 张";
const GENERATION_STEP_MESSAGES = [
  "正在读取照片信息",
  "正在调用视觉检测服务",
  "正在分析外墙缺陷区域",
  "正在生成标注结果"
] as const;
const TRIAL_REQUEST_STORAGE_PREFIX = "exterior-wall:active-trial-request:";
const PHOTO_DELETE_UNDO_MILLISECONDS = 6000;
const EMPTY_TRIAL_PHOTO_METADATA: TrialPhotoMetadata = {
  xmpDroneDjiImageSource: null,
  ifd0ImageDescription: null,
  thermalImagingAvailable: false
};

type TrialPhotoUploadStatus = "ready" | "uploading" | "uploaded" | "failed";
type TrialGeneratedFile = TrialGeneratedResult["files"][number];

interface SelectedTrialPhoto {
  id: string;
  file: File;
  metadata: TrialPhotoMetadata;
  uploadStatus: TrialPhotoUploadStatus;
  uploadProgress: number;
  uploadError?: string;
  unsupportedFormat?: boolean;
  uploadedPhoto?: TrialUploadedPhoto;
  generatedFile?: TrialGeneratedFile;
  isArchived?: boolean;
}

interface SelectedPhotoPreview extends SelectedTrialPhoto {
  previewUrl: string;
}

interface TrialPhotoUploadSuccess {
  uploadedPhoto: TrialUploadedPhoto;
  generatedFile: TrialGeneratedFile;
}

interface TrialAnnotatedPreview {
  filename: string;
  previewUrl: string;
  findings: TrialGeneratedResult["findings"];
}

interface RemovedTrialPhoto {
  index: number;
  photo: SelectedTrialPhoto;
}

type TrialDetectionDialogStage = "confirmation" | "progress" | "completed" | "error";

interface PreparedTrialDetection {
  appendToReportId: string | null;
  photoCount: number;
  photoIds: string[];
  thermalPhotoCount: number;
  reportName?: string;
}

function trialRequestStorageKey(userId: string) {
  return `${TRIAL_REQUEST_STORAGE_PREFIX}${userId}`;
}

export function TrialExperiencePage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const resultPanelRef = useRef<HTMLElement | null>(null);
  const previewDragRef = useRef<{ pointerId: number; x: number; y: number; distance: number } | null>(null);
  const previewDragMovedRef = useRef(false);
  const allowNavigationRef = useRef(false);
  const removedPhotoRef = useRef<RemovedTrialPhoto | null>(null);
  const photoDeleteTimerRef = useRef<number | null>(null);
  const handledTrialRequestIdsRef = useRef(new Set<string>());
  const [selectedPhotos, setSelectedPhotos] = useState<SelectedTrialPhoto[]>([]);
  const [selectedModels, setSelectedModels] = useState<Array<(typeof MODEL_OPTIONS)[number]>>([...MODEL_OPTIONS]);
  const [modelSelectionError, setModelSelectionError] = useState("");
  const [reportName, setReportName] = useState("");
  const [savedReportName, setSavedReportName] = useState("");
  const [error, setError] = useState("");
  const [actionHint, setActionHint] = useState("");
  const [generatedResult, setGeneratedResult] = useState<TrialGeneratedResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isReportNameSaving, setIsReportNameSaving] = useState(false);
  const [archivedReportId, setArchivedReportId] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [annotatedPreview, setAnnotatedPreview] = useState<TrialAnnotatedPreview | null>(null);
  const [previewZoom, setPreviewZoom] = useState(PHOTO_PREVIEW_DEFAULT_ZOOM);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [generationStepIndex, setGenerationStepIndex] = useState(0);
  const [detectionDialogStage, setDetectionDialogStage] = useState<TrialDetectionDialogStage | null>(null);
  const [detectionDialogMessage, setDetectionDialogMessage] = useState("");
  const [preparedDetection, setPreparedDetection] = useState<PreparedTrialDetection | null>(null);
  const [isVersionNoticeOpen, setIsVersionNoticeOpen] = useState(true);
  const [guideExampleTab, setGuideExampleTab] = useState<"original" | "annotated">("original");
  const [recentlyRemovedPhoto, setRecentlyRemovedPhoto] = useState<RemovedTrialPhoto | null>(null);
  const [activeTrialRequestId, setActiveTrialRequestId] = useState<string | null>(() => {
    if (!user) return null;
    try {
      return window.localStorage.getItem(trialRequestStorageKey(user.id));
    } catch {
      return null;
    }
  });

  const pendingPhotos = useMemo(
    () => selectedPhotos.filter((photo) => !photo.isArchived),
    [selectedPhotos]
  );
  const qualifiedPendingPhotos = useMemo(
    () => pendingPhotos.filter((photo) => (
      photo.uploadStatus === "uploaded"
      && photo.uploadedPhoto?.precheck_status === "passed"
    )),
    [pendingPhotos]
  );
  const incompletePrecheckPhotos = useMemo(
    () => pendingPhotos.filter((photo) => (
      photo.uploadStatus === "uploaded"
      && photo.uploadedPhoto
      && ["pending", "running", "error"].includes(photo.uploadedPhoto.precheck_status)
    )),
    [pendingPhotos]
  );
  const isHollowSelected = selectedModels.includes("空鼓");
  const isModelSelectionInvalid = Boolean(modelSelectionError);

  const photoPreviews = useMemo<SelectedPhotoPreview[]>(
    () => selectedPhotos.map((photo) => ({
      ...photo,
      previewUrl: URL.createObjectURL(photo.file)
    })),
    [selectedPhotos]
  );
  const reportRows = useMemo(() => {
    if (!generatedResult) return [];
    const previewByPhotoId = new Map(
      photoPreviews
        .filter((photo) => photo.uploadedPhoto)
        .map((photo) => [photo.uploadedPhoto?.id as string, photo.previewUrl])
    );
    return generatedResult.files.map((file, index) => {
      const findings = generatedResult.findings.filter((item) => (
        isTrialResultFinding(item)
        && (file.photo_id ? item.photo_id === file.photo_id : item.filename === file.filename)
      ));
      return {
        filename: file.filename,
        previewUrl: file.photo_id ? previewByPhotoId.get(file.photo_id) ?? "" : photoPreviews[index]?.previewUrl ?? "",
        findings
      };
    });
  }, [generatedResult, photoPreviews]);
  const isUploading = pendingPhotos.some((photo) => photo.uploadStatus === "uploading");
  const isInteractionBusy = isUploading || isGenerating || isArchiving;
  const isPhotoEditingLocked = isInteractionBusy || (Boolean(generatedResult) && !archivedReportId);
  const canContinueDetection = Boolean(archivedReportId)
    && qualifiedPendingPhotos.length > 0
    && incompletePrecheckPhotos.length === 0;
  const isReportNameLocked = isGenerating || isArchiving || isReportNameSaving;
  const isReportNameDirty = Boolean(archivedReportId) && reportName.trim() !== savedReportName;
  const hasUnsafePageWork = isUploading
    || isGenerating
    || isArchiving
    || isReportNameDirty
    || pendingPhotos.length > 0
    || (!archivedReportId && Boolean(reportName.trim()));
  const navigationBlocker = useBlocker(({ currentLocation, nextLocation }) => (
    !allowNavigationRef.current
    && hasUnsafePageWork
    && `${currentLocation.pathname}${currentLocation.search}` !== `${nextLocation.pathname}${nextLocation.search}`
  ));

  useBeforeUnload((event) => {
    if (!hasUnsafePageWork) return;
    event.preventDefault();
  });

  const acceptTrialResult = useCallback((
    requestId: string,
    generated: TrialGeneratedResult,
    appendToExisting: boolean
  ) => {
    if (handledTrialRequestIdsRef.current.has(requestId)) return;
    handledTrialRequestIdsRef.current.add(requestId);
    setGeneratedResult((current) => (
      current && appendToExisting
        ? mergeTrialGeneratedResults(current, generated)
        : generated
    ));
    setPreparedDetection(null);
    setDetectionDialogMessage("");
    setDetectionDialogStage("completed");
    if (generated.archived_report_id) {
      setArchivedReportId(generated.archived_report_id);
      const archivedTitle = generated.archived_report_title ?? (generated.report_name?.trim() || "");
      setReportName(archivedTitle);
      setSavedReportName(archivedTitle);
      const archivedPhotoIds = new Set(
        generated.files
          .map((file) => file.photo_id)
          .filter((photoId): photoId is string => Boolean(photoId))
      );
      setSelectedPhotos((current) => current.map((photo) => (
        photo.uploadedPhoto && archivedPhotoIds.has(photo.uploadedPhoto.id)
          ? { ...photo, isArchived: true }
          : photo
      )));
    }
  }, []);

  useEffect(() => () => {
    photoPreviews.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
  }, [photoPreviews]);

  useEffect(() => {
    if (!activeTrialRequestId || !user) return undefined;
    let disposed = false;
    setIsGenerating(true);
    setDetectionDialogMessage("");
    setDetectionDialogStage("progress");

    const refreshStatus = async () => {
      try {
        const requestStatus = await getTrialRequestStatus(activeTrialRequestId);
        if (disposed) return;
        if (requestStatus.status === "processing") {
          setIsGenerating(true);
          setActionHint("");
          return;
        }
        if (requestStatus.status === "completed" && requestStatus.result) {
          acceptTrialResult(
            activeTrialRequestId,
            requestStatus.result,
            Boolean(archivedReportId && generatedResult)
          );
          clearActiveTrialRequest(activeTrialRequestId);
          setIsGenerating(false);
          setError("");
          setActionHint("");
          return;
        }
        clearActiveTrialRequest(activeTrialRequestId);
        setIsGenerating(false);
        setActionHint("");
        const requestError = requestStatus.error || "此前提交的检测任务失败，请重新发起。";
        setError(requestError);
        setDetectionDialogMessage(requestError);
        setDetectionDialogStage("error");
      } catch (statusError) {
        if (disposed) return;
        if (statusError instanceof ApiError && statusError.status === 404) return;
        if (!(statusError instanceof ApiError && statusError.status === 0)) {
          setError(statusError instanceof Error ? statusError.message : "检测任务状态查询失败。");
        }
      }
    };

    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 3000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [acceptTrialResult, activeTrialRequestId, archivedReportId, generatedResult, user]);

  useEffect(() => {
    if (navigationBlocker.state !== "blocked") return;

    const confirmAndLeave = async () => {
      const warning = isGenerating
        ? "检测任务仍在执行。确认离开后可稍后在“试用记录”中查看，且请勿重复提交。"
        : "当前有未完成或未保存的内容。确认离开？未归档的上传照片将被清理。";
      if (!window.confirm(warning)) {
        navigationBlocker.reset();
        return;
      }
      if (isReportNameDirty && !(await saveArchivedReportName())) {
        navigationBlocker.reset();
        return;
      }
      if (!isGenerating) await discardPendingUploads();
      allowNavigationRef.current = true;
      navigationBlocker.proceed();
    };

    void confirmAndLeave();
  }, [navigationBlocker.state]);

  useEffect(() => () => {
    if (photoDeleteTimerRef.current !== null) {
      window.clearTimeout(photoDeleteTimerRef.current);
    }
    const removed = removedPhotoRef.current;
    if (removed?.photo.uploadedPhoto) {
      void deleteTrialPhoto(removed.photo.uploadedPhoto.id);
    }
  }, []);

  useEffect(() => {
    if (previewIndex === null && !annotatedPreview) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closePhotoPreview();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [annotatedPreview, previewIndex]);

  useEffect(() => {
    if (!isGenerating) {
      setGenerationStepIndex(0);
      return;
    }

    const stepTimer = window.setInterval(() => {
      setGenerationStepIndex((current) => Math.min(current + 1, GENERATION_STEP_MESSAGES.length - 1));
    }, 1600);

    return () => {
      window.clearInterval(stepTimer);
    };
  }, [isGenerating]);

  async function applyFiles(fileList: File[]) {
    if (!fileList.length || isPhotoEditingLocked) return;

    setActionHint("");
    const rejectionMessages: string[] = [];
    const selected = fileList.filter((file) => {
      const message = validatePhotoUpload(file, { maxSizeBytes: MAX_TRIAL_PHOTO_SIZE_BYTES });
      if (message) {
        rejectionMessages.push(`${file.name}: ${message}`);
        return false;
      }
      return true;
    });

    const remainingSlots = MAX_TRIAL_PHOTO_COUNT - pendingPhotos.length;
    if (remainingSlots <= 0) {
      setError(`单次最多上传 ${MAX_TRIAL_PHOTO_COUNT} 张照片。`);
      return;
    }
    const accepted = selected.slice(0, remainingSlots);
    if (!accepted.length) {
      setError(rejectionMessages[0] ?? "未选择可上传的照片。");
      return;
    }

    const limitMessage = selected.length > accepted.length
      ? `单次最多上传 ${MAX_TRIAL_PHOTO_COUNT} 张照片，已添加前 ${remainingSlots} 张。`
      : "";
    setError(rejectionMessages[0] ?? limitMessage);

    const nextPhotos = await Promise.all(
      accepted.map(createSelectedTrialPhoto)
    );
    const startIndex = selectedPhotos.length;

    setSelectedPhotos((current) => [
      ...current,
      ...nextPhotos
    ]);
    nextPhotos.forEach((photo, offset) => {
      void uploadTrialPhoto(photo, startIndex + offset);
    });
  }

  function previewPhoto(index: number) {
    resetPhotoPreviewTransform();
    setAnnotatedPreview(null);
    setPreviewIndex(index);
  }

  function previewAnnotatedPhoto(preview: TrialAnnotatedPreview) {
    if (!preview.previewUrl) return;
    resetPhotoPreviewTransform();
    setPreviewIndex(null);
    setAnnotatedPreview(preview);
  }

  function resetPhotoPreviewTransform() {
    previewDragRef.current = null;
    previewDragMovedRef.current = false;
    setPreviewZoom(PHOTO_PREVIEW_DEFAULT_ZOOM);
    setPreviewPan({ x: 0, y: 0 });
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
    previewDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, distance: 0 };
  }

  function movePhotoPreview(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = previewDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    const distance = drag.distance + Math.abs(deltaX) + Math.abs(deltaY);
    if (distance >= 3) previewDragMovedRef.current = true;
    previewDragRef.current = { ...drag, x: event.clientX, y: event.clientY, distance };
    setPreviewPan((current) => clampPreviewPan({ x: current.x + deltaX, y: current.y + deltaY }, previewZoom));
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

  function removePhoto(index: number) {
    if (isPhotoEditingLocked) return;
    const photo = selectedPhotos[index];
    if (!photo || photo.isArchived) return;
    void finalizePendingPhotoRemoval();
    const removal = { index, photo };
    removedPhotoRef.current = removal;
    setRecentlyRemovedPhoto(removal);
    setSelectedPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index));
    setPreviewIndex((current) => (
      current === null ? null : current === index ? null : current > index ? current - 1 : current
    ));
    setError("");
    photoDeleteTimerRef.current = window.setTimeout(() => {
      void finalizePendingPhotoRemoval();
    }, PHOTO_DELETE_UNDO_MILLISECONDS);
  }

  async function finalizePendingPhotoRemoval() {
    const removal = removedPhotoRef.current;
    if (!removal) return;
    if (photoDeleteTimerRef.current !== null) {
      window.clearTimeout(photoDeleteTimerRef.current);
      photoDeleteTimerRef.current = null;
    }
    removedPhotoRef.current = null;
    setRecentlyRemovedPhoto(null);
    if (!removal.photo.uploadedPhoto) return;
    try {
      await deleteTrialPhoto(removal.photo.uploadedPhoto.id);
    } catch (deleteError) {
      setSelectedPhotos((current) => {
        if (current.some((photo) => photo.id === removal.photo.id)) return current;
        const next = [...current];
        next.splice(Math.min(removal.index, next.length), 0, removal.photo);
        return next;
      });
      setError(deleteError instanceof Error ? `${deleteError.message}，照片已恢复。` : "删除照片失败，照片已恢复。");
    }
  }

  function undoPhotoRemoval() {
    const removal = removedPhotoRef.current;
    if (!removal) return;
    if (photoDeleteTimerRef.current !== null) {
      window.clearTimeout(photoDeleteTimerRef.current);
      photoDeleteTimerRef.current = null;
    }
    removedPhotoRef.current = null;
    setRecentlyRemovedPhoto(null);
    setSelectedPhotos((current) => {
      if (current.some((photo) => photo.id === removal.photo.id)) return current;
      const next = [...current];
      next.splice(Math.min(removal.index, next.length), 0, removal.photo);
      return next;
    });
    setActionHint("已撤销删除。");
  }

  function closePhotoPreview() {
    setPreviewIndex(null);
    setAnnotatedPreview(null);
    resetPhotoPreviewTransform();
  }

  function updateReportName(value: string) {
    setReportName(value);
    setError("");
  }

  function toggleModel(model: (typeof MODEL_OPTIONS)[number]) {
    if (isInteractionBusy) return;
    setSelectedModels((current) => (
      current.includes(model)
        ? current.filter((item) => item !== model)
        : MODEL_OPTIONS.filter((item) => item === model || current.includes(item))
    ));
    setModelSelectionError("");
    setError("");
  }

  async function saveArchivedReportName(): Promise<boolean> {
    const title = reportName.trim();
    if (!archivedReportId || !isReportNameDirty) return true;
    if (isReportNameSaving) return false;
    if (!title) {
      setError("请输入检测名称。");
      return false;
    }

    setIsReportNameSaving(true);
    setError("");
    try {
      const updated = await updateTrialReportTitle(archivedReportId, title);
      setReportName(updated.title);
      setSavedReportName(updated.title);
      setActionHint("检测名称已保存。");
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "检测名称保存失败，请稍后重试。");
      return false;
    } finally {
      setIsReportNameSaving(false);
    }
  }

  function persistActiveTrialRequest(requestId: string) {
    setActiveTrialRequestId(requestId);
    if (!user) return;
    try {
      window.localStorage.setItem(trialRequestStorageKey(user.id), requestId);
    } catch {
      // Recovery remains available in-memory when storage is unavailable.
    }
  }

  function clearActiveTrialRequest(requestId: string) {
    setActiveTrialRequestId((current) => current === requestId ? null : current);
    if (!user) return;
    try {
      if (window.localStorage.getItem(trialRequestStorageKey(user.id)) === requestId) {
        window.localStorage.removeItem(trialRequestStorageKey(user.id));
      }
    } catch {
      // No action needed when browser storage is unavailable.
    }
  }

  async function discardPendingUploads() {
    await finalizePendingPhotoRemoval();
    const unarchivedPhotos = selectedPhotos.filter((photo) => !photo.isArchived);
    await Promise.allSettled(unarchivedPhotos.map((photo) => (
      photo.uploadedPhoto ? deleteTrialPhoto(photo.uploadedPhoto.id) : Promise.resolve()
    )));
  }

  async function finishAndExit() {
    if (isReportNameDirty && !(await saveArchivedReportName())) return;
    navigate("/");
  }

  function generateReport() {
    setActionHint("");
    if (!pendingPhotos.length) {
      setError("请先上传新照片。");
      return;
    }

    if (isUploading) {
      setError("照片正在上传，请等待上传完成。");
      return;
    }

    const unsupportedFormatCount = pendingPhotos.filter((photo) => photo.unsupportedFormat).length;
    if (unsupportedFormatCount) {
      setError(`${unsupportedFormatCount} 张照片格式不受支持，请删除后再开始检测。`);
      return;
    }

    const failedCount = pendingPhotos.filter((photo) => photo.uploadStatus === "failed").length;
    if (failedCount) {
      setError(`${failedCount} 张照片上传失败，请先单张重新上传。`);
      return;
    }

    if (incompletePrecheckPhotos.length) {
      const failedPrecheckCount = incompletePrecheckPhotos.filter(
        (photo) => photo.uploadedPhoto?.precheck_status === "error"
      ).length;
      setError(
        failedPrecheckCount
          ? `${failedPrecheckCount} 张照片预检失败，请删除后重新上传。`
          : "照片仍在预检中，请稍后再开始检测。"
      );
      return;
    }

    if (!qualifiedPendingPhotos.length) {
      setError("没有通过建筑照片预检的照片；不合格原图仍已保留，可预览或删除。如需再次判断，请重新上传。");
      return;
    }

    const thermalPhotoCount = qualifiedPendingPhotos.filter(
      (photo) => photo.uploadedPhoto?.thermal_imaging_available
    ).length;

    const photoIds = qualifiedPendingPhotos
      .map((photo) => photo.uploadedPhoto?.id)
      .filter((photoId): photoId is string => Boolean(photoId));
    if (photoIds.length !== qualifiedPendingPhotos.length) {
      setError("请等待照片上传完成。");
      return;
    }

    setPreparedDetection({
      appendToReportId: archivedReportId,
      photoCount: qualifiedPendingPhotos.length,
      photoIds,
      thermalPhotoCount,
      reportName: reportName.trim() || undefined
    });
    setDetectionDialogMessage("");
    setDetectionDialogStage("confirmation");
  }

  async function confirmDetection(payload: StartDetectionPayload) {
    if (!preparedDetection || isGenerating) return;
    const models = payload.model_types.map((model) => (
      model === "crack" ? "裂缝" : model === "spalling" ? "剥落" : "空鼓"
    ));
    const previousResult = generatedResult;
    const requestId = createClientId("trial-detection");
    persistActiveTrialRequest(requestId);
    setIsGenerating(true);
    setDetectionDialogMessage("");
    setDetectionDialogStage("progress");
    setError("");
    setActionHint("");
    let keepRecovering = false;
    try {
      const generated = await generateTrialResult({
        report_name: preparedDetection.reportName,
        models,
        photo_ids: preparedDetection.photoIds,
        archived_report_id: preparedDetection.appendToReportId ?? undefined
      }, requestId);
      acceptTrialResult(requestId, generated, Boolean(previousResult && preparedDetection.appendToReportId));
      clearActiveTrialRequest(requestId);
      setIsGenerating(false);
      if (!generated.archived_report_id) {
        // 兼容尚未升级为服务端自动归档的后端版本。
        await archiveGeneratedResult(generated, new Set(preparedDetection.photoIds));
      }
    } catch (generateError) {
      keepRecovering = generateError instanceof ApiError
        && (generateError.status === 0 || (generateError.status === 409 && generateError.message.includes("处理中")));
      const message = generateError instanceof ApiError && generateError.status === 401
        ? "请先登录后再生成检测结果。"
        : keepRecovering
          ? "连接中断，但检测任务可能仍在执行；系统正在自动查询结果，请勿重复提交。"
        : generateError instanceof Error ? generateError.message : "生成检测结果失败。";
      setError(message);
      if (keepRecovering) {
        setDetectionDialogMessage(message);
      } else {
        clearActiveTrialRequest(requestId);
        setDetectionDialogMessage(message);
        setDetectionDialogStage("error");
      }
    } finally {
      if (!keepRecovering) setIsGenerating(false);
    }
  }

  function viewDetectionResult() {
    if (!archivedReportId) return;
    allowNavigationRef.current = true;
    setDetectionDialogStage(null);
    navigate(`/trials/${archivedReportId}`);
  }

  function returnToTrialList() {
    allowNavigationRef.current = true;
    setDetectionDialogStage(null);
    navigate("/trials");
  }

  function handleGeneratedPrimaryAction() {
    if (!archivedReportId) {
      void archiveGeneratedResult();
      return;
    }
    if (!pendingPhotos.length) {
      setError("");
      setActionHint("请继续添加新照片。");
      return;
    }
    void generateReport();
  }

  async function retryPhoto(index: number) {
    const photo = selectedPhotos[index];
    if (!photo || photo.isArchived || isPhotoEditingLocked) return;

    setError("");
    const result = await uploadTrialPhoto(photo, index);
    if (!result) {
      setError("该照片重新上传失败，请查看照片卡片中的提示。");
    }
  }

  async function uploadTrialPhoto(
    photo: SelectedTrialPhoto,
    index: number
  ): Promise<TrialPhotoUploadSuccess | null> {
    setSelectedPhotos((current) => current.map((currentPhoto) => (
      currentPhoto.id === photo.id
        ? { ...resetTrialPhotoUpload(currentPhoto), uploadStatus: "uploading", uploadProgress: 0 }
        : currentPhoto
    )));

    try {
      const uploadedPhoto = await runTrialPhotoUpload(() => (
        uploadTrialPhotoFile(photo.file, (progress) => {
          setSelectedPhotos((current) => current.map((currentPhoto) => (
            currentPhoto.id === photo.id
              ? { ...currentPhoto, uploadProgress: progress.percent }
              : currentPhoto
          )));
        })
      ));

      const generatedFile = {
        photo_id: uploadedPhoto.id,
        filename: uploadedPhoto.original_filename,
        size: uploadedPhoto.file_size ?? photo.file.size
      };
      const uploadResult = { uploadedPhoto, generatedFile };
      setSelectedPhotos((current) => current.map((currentPhoto) => (
        currentPhoto.id === photo.id ? photoWithUploadResult(currentPhoto, uploadResult) : currentPhoto
      )));
      return uploadResult;
    } catch (uploadError) {
      const message = trialUploadErrorMessage(uploadError);
      setSelectedPhotos((current) => current.map((currentPhoto) => (
        currentPhoto.id === photo.id
          ? {
            ...currentPhoto,
            uploadStatus: "failed",
            uploadError: message,
            unsupportedFormat: isUnsupportedTrialPhotoFormatError(uploadError)
          }
          : currentPhoto
      )));
      return null;
    }
  }

  async function archiveGeneratedResult(
    result: TrialGeneratedResult | null = generatedResult,
    archivedPhotoIds?: Set<string>
  ) {
    if (!result) {
      setError("请先生成检测结果。");
      return;
    }
    if (!selectedPhotos.length) {
      setError("请先上传照片。");
      return;
    }

    setIsArchiving(true);
    setError("");
    try {
      const archivedResult = await archiveTrialResult({
        ...result,
        report_name: reportName.trim() || undefined,
        findings: result.findings.filter(isTrialResultFinding)
      });
      setArchivedReportId(archivedResult.id);
      setReportName(archivedResult.title);
      setSavedReportName(archivedResult.title);
      const photoIds = archivedPhotoIds ?? new Set(
        result.files
          .map((file) => file.photo_id)
          .filter((photoId): photoId is string => Boolean(photoId))
      );
      setSelectedPhotos((current) => current.map((photo) => (
        photo.uploadedPhoto && photoIds.has(photo.uploadedPhoto.id)
          ? { ...photo, isArchived: true }
          : photo
      )));
    } catch (archiveError) {
      const message = archiveError instanceof ApiError && archiveError.status === 401
        ? "请先登录后再存档检测结果。"
        : archiveError instanceof Error ? archiveError.message : "存档检测结果失败。";
      setError(message);
    } finally {
      setIsArchiving(false);
    }
  }

  const previewingPhoto = previewIndex === null ? null : photoPreviews[previewIndex] ?? null;
  const detectionProgress = [18, 42, 68, 88][generationStepIndex] ?? 88;
  const totalPhotoCount = pendingPhotos.length;
  const uploadedPhotoCount = pendingPhotos.filter((photo) => photo.uploadStatus === "uploaded").length;
  const failedPhotoCount = pendingPhotos.filter((photo) => photo.uploadStatus === "failed").length;
  const activePhotoUploadCount = pendingPhotos.filter(
    (photo) => photo.uploadStatus === "ready" || photo.uploadStatus === "uploading"
  ).length;
  const photoUploadProgress = totalPhotoCount
    ? Math.round(uploadedPhotoCount / totalPhotoCount * 100)
    : 0;
  const allPhotosUploaded = totalPhotoCount > 0 && uploadedPhotoCount === totalPhotoCount;

  function openProfessionalDetection() {
    allowNavigationRef.current = true;
    navigate("/detections/new");
  }

  return (
    <>
      <ProjectWorkbenchShell actionLabel="返回" hideHeader>
        <div className="trial-new-project-layout">
        <form className="create-workspace" onSubmit={(event) => event.preventDefault()}>
          <h1 className="sr-only">AI检测体验</h1>
          <section className="project-editor-panel" aria-label="AI检测体验">
            <div className="project-fields project-editor-basic-fields">
              <label className="form-field">
                <span>检测名称：</span>
                <input
                  disabled={isReportNameLocked}
                  maxLength={255}
                  value={reportName}
                  onBlur={() => void saveArchivedReportName()}
                  onChange={(event) => updateReportName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveArchivedReportName();
                  }}
                />
              </label>
              <div className="trial-name-actions">
                <button
                  className="button primary start-ai-detection-button"
                  disabled={isPhotoEditingLocked}
                  type="button"
                  onClick={generateReport}
                >
                  <ScanSearch aria-hidden="true" />
                  {isGenerating ? "检测中" : "开始检测"}
                </button>
              </div>
            </div>

            <div className="project-editor-photo-block">
              <section className="project-photo-workspace" aria-labelledby="trial-project-photo-title">
                <header className="project-photo-workspace-heading">
                  <h2 id="trial-project-photo-title">检测照片</h2>
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
                      <span className="new-project-upload-summary is-complete photo-upload-complete-status">上传完成</span>
                    ) : null}
                  </div>
                </header>
                <ProjectPhotoUploader
                  addDisabled={isPhotoEditingLocked}
                  disabled={isPhotoEditingLocked}
                  hasPhotos={Boolean(photoPreviews.length)}
                  onFilesSelected={(files) => void applyFiles(files)}
                >
                  {photoPreviews.map((photo, index) => {
                    const precheckStatus = photo.uploadedPhoto?.precheck_status;
                    const thermalAvailable = photo.uploadStatus === "uploaded"
                      && (photo.uploadedPhoto?.thermal_imaging_available ?? photo.metadata.thermalImagingAvailable);
                    return (
                      <PhotoUploadThumbnail
                        badges={thermalAvailable ? <span className="trial-thermal-available-tag">热成像</span> : null}
                        fileName={photo.file.name}
                        footer={photo.uploadStatus === "failed" && !photo.unsupportedFormat ? (
                          <>
                            <p className="trial-photo-upload-error">{photo.uploadError || "上传失败，请重新上传。"}</p>
                            <button
                              className="trial-photo-retry-button"
                              disabled={isPhotoEditingLocked}
                              type="button"
                              onClick={() => void retryPhoto(index)}
                            >
                              <RefreshCcw aria-hidden="true" />
                              重新上传
                            </button>
                          </>
                        ) : null}
                        key={photo.id}
                        precheckReason={photo.uploadedPhoto?.precheck_reason}
                        precheckStatus={precheckStatus}
                        previewUrl={photo.previewUrl}
                        removeDisabled={isPhotoEditingLocked}
                        statusClassName={`is-${photo.uploadStatus}`}
                        unsupportedFormat={photo.unsupportedFormat}
                        onPreview={photo.uploadStatus === "uploaded" ? () => previewPhoto(index) : undefined}
                        onRemove={!photo.isArchived ? () => void removePhoto(index) : undefined}
                      >
                        {photo.uploadStatus === "ready" || photo.uploadStatus === "uploading" ? (
                          <span
                            aria-label={`${photo.file.name}${photo.uploadStatus === "ready" ? "等待上传" : "正在上传"}`}
                            className="new-project-photo-upload-indicator"
                            role="status"
                          >
                            <span aria-hidden="true" className="new-project-photo-upload-ring" />
                            <small>{photo.uploadStatus === "ready" ? "等待上传" : "上传中"}</small>
                          </span>
                        ) : null}
                      </PhotoUploadThumbnail>
                    );
                  })}
                </ProjectPhotoUploader>
              </section>
            </div>

            <section className="trial-project-feedback" aria-live="polite">
              {error ? <p className="create-form-error">{error}</p> : null}
              {actionHint ? <p className="trial-action-hint">{actionHint}</p> : null}
              {recentlyRemovedPhoto ? (
                <p className="trial-undo-message" role="status">
                  已移除“{recentlyRemovedPhoto.photo.file.name}”
                  <button type="button" onClick={undoPhotoRemoval}>撤销</button>
                </p>
              ) : null}
            </section>
          </section>
        </form>
        <DetectionGuidePanel
          description={<>支持<span className="trial-defect-types">裂缝、剥落、空鼓</span>外墙缺陷识别</>}
        />
        </div>
      </ProjectWorkbenchShell>
      {false ? <div className="trial-detection-page management-list-page">
        <div className="project-workspace">
          <div className="trial-experience-shell trial-experience-content-shell trial-live-shell">
            <section className="trial-experience-grid trial-workbench-layout">
          <aside className="trial-upload-panel trial-workbench-sidebar">
            <header className="trial-workbench-sidebar-heading">
              <span aria-hidden="true"><Sparkles /></span>
              <div>
                <strong>AI检测体验</strong>
                <small>上传照片，直接生成检测结果</small>
              </div>
            </header>
            <div className="trial-report-name-field">
              <h2>检测名称：</h2>
              <div className="trial-report-name-control">
                <label className="sr-only" htmlFor="trial-report-name">检测名称</label>
                <input
                  id="trial-report-name"
                  disabled={isReportNameLocked}
                  maxLength={255}
                  placeholder="请输入检测名称"
                  value={reportName}
                  onChange={(event) => updateReportName(event.target.value)}
                  onBlur={() => void saveArchivedReportName()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveArchivedReportName();
                  }}
                />
                {archivedReportId ? (
                  <button
                    className="trial-report-name-save"
                    disabled={isReportNameSaving || !isReportNameDirty}
                    type="button"
                    onClick={() => void saveArchivedReportName()}
                  >
                    {isReportNameSaving ? "保存中" : "保存名称"}
                  </button>
                ) : null}
              </div>
            </div>
            <fieldset
              className={`trial-model-selector ${isModelSelectionInvalid ? "is-invalid" : ""}`}
              aria-describedby={[
                isModelSelectionInvalid ? "trial-model-selection-error" : "",
                isHollowSelected ? "trial-hollow-beta-warning" : ""
              ].filter(Boolean).join(" ") || undefined}
              aria-invalid={isModelSelectionInvalid}
              aria-label="选择检测类型"
              disabled={isInteractionBusy}
            >
              <legend className="sr-only">检测类型</legend>
              <div className="trial-model-selector-row">
                <span aria-hidden="true" className="trial-model-selector-title">检测类型：</span>
                <div className="trial-model-options">
                  {MODEL_OPTIONS.map((model) => (
                    <label
                      key={model}
                      className={[
                        selectedModels.includes(model) ? "is-selected" : "",
                        model === "空鼓" ? "is-beta-model" : ""
                      ].filter(Boolean).join(" ")}
                    >
                      <input
                        checked={selectedModels.includes(model)}
                        type="checkbox"
                        onChange={() => toggleModel(model)}
                      />
                      <span><Check aria-hidden="true" /></span>
                      <strong>{model}{model === "空鼓" ? "（Beta）" : ""}</strong>
                    </label>
                  ))}
                </div>
              </div>
              {isHollowSelected ? (
                <p id="trial-hollow-beta-warning" className="trial-model-warning" role="status">
                  <TriangleAlert aria-hidden="true" />
                  空鼓检测处于测试阶段，可能存在误检，请结合现场情况复核。
                </p>
              ) : null}
              {isModelSelectionInvalid ? (
                <p id="trial-model-selection-error" className="trial-model-selection-error">
                  {modelSelectionError}
                </p>
              ) : null}
            </fieldset>
            <ProjectPhotoUploader
              disabled={isPhotoEditingLocked}
              emptyHint={<span className="trial-upload-note">{UPLOAD_LIMIT_TIP}</span>}
              hasPhotos={Boolean(photoPreviews.length)}
              variant="trial"
              onFilesSelected={(files) => void applyFiles(files)}
            >
              {photoPreviews.map((photo, index) => {
                const precheckStatus = photo.uploadedPhoto?.precheck_status;
                const thermalAvailable = photo.uploadStatus === "uploaded"
                  && (photo.uploadedPhoto?.thermal_imaging_available ?? photo.metadata.thermalImagingAvailable);
                return (
                  <PhotoUploadThumbnail
                    badges={thermalAvailable ? <span className="trial-thermal-available-tag">热成像</span> : null}
                    fileName={photo.file.name}
                    footer={photo.uploadStatus === "failed" && !photo.unsupportedFormat ? (
                      <>
                        <p className="trial-photo-upload-error">{photo.uploadError || "上传失败，请重新上传。"}</p>
                        <button
                          className="trial-photo-retry-button"
                          disabled={isPhotoEditingLocked}
                          type="button"
                          onClick={() => void retryPhoto(index)}
                        >
                          <RefreshCcw aria-hidden="true" />
                          重新上传
                        </button>
                      </>
                    ) : null}
                    key={photo.id}
                    precheckReason={photo.uploadedPhoto?.precheck_reason}
                    precheckStatus={precheckStatus}
                    previewUrl={photo.previewUrl}
                    removeDisabled={isPhotoEditingLocked}
                    statusClassName={`is-${photo.uploadStatus}`}
                    unsupportedFormat={photo.unsupportedFormat}
                    variant="trial"
                    onPreview={photo.uploadStatus === "uploaded" ? () => previewPhoto(index) : undefined}
                    onRemove={!photo.isArchived ? () => void removePhoto(index) : undefined}
                  >
                    {photo.uploadStatus === "ready" || photo.uploadStatus === "uploading" ? (
                      <span
                        aria-label={`${photo.file.name}${photo.uploadStatus === "ready" ? "等待上传" : "正在上传"}`}
                        className="new-project-photo-upload-indicator"
                        role="status"
                      >
                        <span aria-hidden="true" className="new-project-photo-upload-ring" />
                        <small>{photo.uploadStatus === "ready" ? "等待上传" : "上传中"}</small>
                      </span>
                    ) : null}
                  </PhotoUploadThumbnail>
                );
              })}
            </ProjectPhotoUploader>
            <div className="trial-feedback" aria-live="polite">
              {error ? <p className="trial-error">{error}</p> : null}
              {actionHint ? <p className="trial-action-hint">{actionHint}</p> : null}
              {recentlyRemovedPhoto ? (
                <p className="trial-undo-message" role="status">
                  已移除“{recentlyRemovedPhoto?.photo.file.name}”
                  <button type="button" onClick={undoPhotoRemoval}>撤销</button>
                </p>
              ) : null}
              {isArchiving ? <p className="trial-status-message">检测完成，正在自动存档...</p> : null}
            </div>
            <div className="trial-actions">
              {generatedResult ? (
                <>
                  <button
                    className={`button primary${archivedReportId && !canContinueDetection ? " is-awaiting-photos" : ""}`}
                    disabled={isGenerating || isArchiving || (Boolean(archivedReportId) && isUploading)}
                    type="button"
                    onClick={handleGeneratedPrimaryAction}
                  >
                    <Send aria-hidden="true" />
                    {isGenerating
                      ? "检测中"
                      : isArchiving
                        ? "自动存档中"
                        : archivedReportId
                          ? "继续检测"
                          : "重试自动存档"}
                  </button>
                  <button
                    className="button secondary trial-exit-button"
                    disabled={isGenerating || isArchiving}
                    type="button"
                    onClick={() => void finishAndExit()}
                  >
                    <Home aria-hidden="true" />
                    完成并退出
                  </button>
                </>
              ) : (
                <button
                  className="button primary trial-generate-button"
                  disabled={isPhotoEditingLocked}
                  type="button"
                  onClick={() => void generateReport()}
                >
                  <Send aria-hidden="true" />
                  {isGenerating ? "检测中" : "开始检测"}
                </button>
              )}
            </div>
          </aside>
          <section
            ref={resultPanelRef}
            className="trial-report-panel trial-workbench-content-panel"
            aria-label="AI检测结果"
            tabIndex={-1}
          >
            <header className="trial-workbench-result-heading">
              <div><ScanSearch aria-hidden="true" /><h2>检测结果</h2></div>
              <span><ShieldCheck aria-hidden="true" />无需审核，完成后直接出结果</span>
            </header>
            {generatedResult ? (
              <div className="trial-report-result is-headless">
                <div className="trial-report-table-wrap">
                  <table className="trial-report-table trial-report-table--without-tile" aria-busy={isGenerating}>
                    <colgroup>
                      <col className="trial-sequence-col" />
                      <col className="trial-photo-col" />
                      <col className="trial-description-col" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className="trial-sequence-column">序号</th>
                        <th className="trial-photo-column">含标注的照片</th>
                        <th className="trial-report-description">检测说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportRows.map((row, index) => (
                        <tr key={`finding-${row.filename}-${index}`}>
                          <td className="trial-sequence-column">
                            <span className="trial-report-index">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                          </td>
                          <td className="trial-photo-column">
                            <figure className="trial-annotated-photo-frame">
                              <div
                                className={`trial-annotated-photo ${row.previewUrl ? "is-clickable" : ""}`}
                                title={row.previewUrl ? "点击放大查看" : undefined}
                                onClick={() => previewAnnotatedPhoto({
                                  filename: row.filename,
                                  previewUrl: row.previewUrl,
                                  findings: row.findings
                                })}
                              >
                                <img alt={`${row.filename} 检测标注`} src={row.previewUrl} />
                                {row.findings.map((finding, findingIndex) => {
                                  const display = trialDefectDisplayFromModel(finding.model);
                                  const boxStyle = trialFindingBoxStyle(finding);
                                  if (!boxStyle) return null;
                                  return (
                                    <span
                                      key={finding.detection_id ?? `${finding.model}-${findingIndex}`}
                                      className={`trial-defect-box ${display.boxClassName}`}
                                      style={boxStyle}
                                    >
                                      <span className="trial-defect-label">
                                        {trialDefectBoxLabel(display)}
                                      </span>
                                    </span>
                                  );
                                })}
                                {row.previewUrl ? (
                                  <div className="trial-annotated-photo-actions">
                                    <button
                                      type="button"
                                      aria-label="放大查看含标注的照片"
                                      title="放大查看"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        previewAnnotatedPhoto({
                                          filename: row.filename,
                                          previewUrl: row.previewUrl,
                                          findings: row.findings
                                        });
                                      }}
                                    >
                                      <ZoomIn aria-hidden="true" />
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                              <figcaption>{row.filename}</figcaption>
                            </figure>
                          </td>
                          <td className="trial-report-description">
                            {row.findings.length ? (
                              <p>
                                {trialFindingSummary(row.findings).map((item) => (
                                  <span key={item.model} className={trialFindingClass(item.model)}>
                                    疑似{trialDefectDisplayFromModel(item.model).label}: {item.count}处
                                  </span>
                                ))}
                              </p>
                            ) : (
                              <p><span>未检出明显缺陷</span></p>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="trial-report-result is-headless">
                <div className="trial-report-table-wrap">
                  <table className="trial-report-table trial-report-table--without-tile" aria-label="检测结果">
                    <colgroup>
                      <col className="trial-sequence-col" />
                      <col className="trial-photo-col" />
                      <col className="trial-description-col" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className="trial-sequence-column">序号</th>
                        <th className="trial-photo-column">含标注的照片</th>
                        <th className="trial-report-description">检测说明</th>
                      </tr>
                    </thead>
                    <tbody />
                  </table>
                  <div className="trial-report-start-guide">
                    <p>完成以下 3 步，即可查看检测结果</p>
                    <ol>
                      <li><span>1</span>选择检测类型</li>
                      <li><span>2</span>上传外墙照片</li>
                      <li><span>3</span>点击开始AI检测</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}
          </section>
          <aside className="trial-guide-panel" aria-label="检测示例">
            <div className="trial-guide-list" id="trial-guide-content">
              <article className="trial-guide-card trial-guide-card-detection">
                <span className="trial-guide-icon" aria-hidden="true">
                  <ScanSearch />
                </span>
                <div>
                  <p>支持<span className="trial-defect-types">裂缝、剥落、空鼓</span>外墙缺陷识别</p>
                </div>
              </article>
              <article className="trial-guide-card trial-guide-card-photo">
                <span className="trial-guide-icon" aria-hidden="true">
                  <Images />
                </span>
                <div>
                  <p>上传画面清晰、墙面完整且无遮挡的照片。</p>
                </div>
              </article>
              <article className="trial-guide-card trial-guide-example-card">
                <div className="trial-guide-example-tabs" role="tablist" aria-label="示例图片类型">
                  <button
                    aria-controls="trial-guide-original-examples"
                    aria-selected={guideExampleTab === "original"}
                    className={guideExampleTab === "original" ? "is-active" : ""}
                    id="trial-guide-original-tab"
                    onClick={() => setGuideExampleTab("original")}
                    role="tab"
                    type="button"
                  >
                    原图示例
                  </button>
                  <button
                    aria-controls="trial-guide-annotated-examples"
                    aria-selected={guideExampleTab === "annotated"}
                    className={guideExampleTab === "annotated" ? "is-active" : ""}
                    id="trial-guide-annotated-tab"
                    onClick={() => setGuideExampleTab("annotated")}
                    role="tab"
                    type="button"
                  >
                    标注示例
                  </button>
                </div>
                {guideExampleTab === "original" ? (
                  <div
                    aria-labelledby="trial-guide-original-tab"
                    className="trial-guide-example-images"
                    id="trial-guide-original-examples"
                    role="tabpanel"
                  >
                    {(["裂缝.jpeg", "剥落.jpg", "空鼓.JPG"] as const).map((filename) => (
                      <figure className="trial-guide-example-item" key={filename}>
                        <div className="trial-guide-example-image-frame">
                          <img
                            alt={`${filename.replace(/\.[^.]+$/, "")}检测原图示例`}
                            loading="lazy"
                            src={`/images/trial/examples/original/${filename}`}
                          />
                        </div>
                        <figcaption>{filename.replace(/\.[^.]+$/, "")}原图</figcaption>
                      </figure>
                    ))}
                  </div>
                ) : (
                  <div
                    aria-labelledby="trial-guide-annotated-tab"
                    className="trial-guide-example-images"
                    id="trial-guide-annotated-examples"
                    role="tabpanel"
                  >
                    {(["裂缝标注图.jpeg", "剥落标注图.png", "空鼓标注图.png"] as const).map((filename) => (
                      <figure className="trial-guide-example-item" key={filename}>
                        <div className="trial-guide-example-image-frame">
                          <img
                            alt={`${filename.replace("标注图", "").replace(/\.[^.]+$/, "")}检测标注结果示例`}
                            loading="lazy"
                            src={`/images/trial/examples/annotated/${filename}`}
                          />
                        </div>
                        <figcaption>{filename.replace(/\.[^.]+$/, "")}</figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </article>
            </div>
          </aside>
          </section>
          </div>
        </div>
      </div> : null}
      {previewingPhoto || annotatedPreview ? (
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
                {annotatedPreview ? (
                  <div className="trial-annotated-photo trial-photo-preview-annotated">
                    <img draggable={false} alt={`${annotatedPreview.filename} 检测标注预览`} src={annotatedPreview.previewUrl} />
                    {annotatedPreview.findings.map((finding, findingIndex) => {
                      const display = trialDefectDisplayFromModel(finding.model);
                      const boxStyle = trialFindingBoxStyle(finding);
                      if (!boxStyle) return null;
                      return (
                        <span
                          key={finding.detection_id ?? `${finding.model}-${findingIndex}`}
                          className={`trial-defect-box ${display.boxClassName}`}
                          style={boxStyle}
                        >
                          <span className="trial-defect-label">
                            {trialDefectBoxLabel(display)}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                ) : previewingPhoto ? (
                  <img draggable={false} alt={previewingPhoto.file.name} src={previewingPhoto.previewUrl} />
                ) : null}
              </div>
            </div>
            <figcaption className="trial-photo-preview-caption">
              {annotatedPreview?.filename ?? previewingPhoto?.file.name}
            </figcaption>
          </figure>
        </div>
      ) : null}
      <StartDetectionModal
        isOpen={detectionDialogStage === "confirmation" && Boolean(preparedDetection)}
        isPending={false}
        qualifiedPhotoCount={preparedDetection?.photoCount ?? 0}
        thermalPhotoCount={preparedDetection?.thermalPhotoCount ?? 0}
        onOpenChange={(isOpen) => {
          if (!isOpen && detectionDialogStage === "confirmation") setDetectionDialogStage(null);
        }}
        onSubmit={(payload) => void confirmDetection(payload)}
      />
      <Modal
        classNames={{
          backdrop: "trial-detection-modal-backdrop",
          base: "trial-detection-modal-content",
          wrapper: "trial-detection-modal-wrapper"
        }}
        hideCloseButton
        isDismissable={false}
        isKeyboardDismissDisabled
        isOpen={detectionDialogStage !== null && detectionDialogStage !== "confirmation"}
        placement="center"
        size="lg"
        onOpenChange={(isOpen) => {
          if (!isOpen && detectionDialogStage !== "progress") setDetectionDialogStage(null);
        }}
      >
        <ModalContent>
          {detectionDialogStage === "progress" ? (
            <>
              <ModalHeader className="trial-detection-modal-header trial-detection-progress-header">
                <span className="trial-detection-modal-visual is-progress" aria-hidden="true">
                  <LoaderCircle />
                </span>
                <div>
                  <small>正在处理</small>
                  <h2>AI检测进行中</h2>
                </div>
              </ModalHeader>
              <ModalBody className="trial-detection-modal-body trial-detection-progress-body">
                <div className="trial-detection-progress-copy">
                  <strong>{GENERATION_STEP_MESSAGES[generationStepIndex]}</strong>
                </div>
                <div
                  aria-label="AI检测进度"
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={detectionProgress}
                  className="trial-detection-progress-track"
                  role="progressbar"
                >
                  <span style={{ width: `${detectionProgress}%` }} />
                </div>
                <ol className="trial-detection-progress-steps">
                  {GENERATION_STEP_MESSAGES.map((message, index) => (
                    <li
                      className={index < generationStepIndex ? "is-complete" : index === generationStepIndex ? "is-current" : ""}
                      key={message}
                    >
                      <span>{index < generationStepIndex ? <Check aria-hidden="true" /> : index + 1}</span>
                      {message}
                    </li>
                  ))}
                </ol>
                <p className="trial-detection-progress-note">
                  {detectionDialogMessage || "检测耗时受照片数量与服务负载影响，请耐心等待。完成后将直接显示结果。"}
                </p>
              </ModalBody>
            </>
          ) : detectionDialogStage === "completed" ? (
            <>
              <ModalHeader className="trial-detection-modal-header trial-detection-progress-header">
                <span className="trial-detection-modal-visual is-completed" aria-hidden="true">
                  <CircleCheckBig />
                </span>
                <div>
                  <small>检测状态</small>
                  <h2>已完成</h2>
                </div>
              </ModalHeader>
              <ModalBody className="trial-detection-modal-body trial-detection-progress-body">
                <div className="trial-detection-progress-copy">
                  <strong>AI检测已完成</strong>
                </div>
                <div
                  aria-label="AI检测进度"
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={100}
                  className="trial-detection-progress-track"
                  role="progressbar"
                >
                  <span style={{ width: "100%" }} />
                </div>
                <ol className="trial-detection-progress-steps">
                  {GENERATION_STEP_MESSAGES.map((message) => (
                    <li className="is-complete" key={message}>
                      <span><Check aria-hidden="true" /></span>
                      {message}
                    </li>
                  ))}
                </ol>
              </ModalBody>
              <ModalFooter className="trial-detection-modal-footer">
                <button
                  className="button secondary trial-return-list-button"
                  disabled={!archivedReportId || isArchiving}
                  type="button"
                  onClick={returnToTrialList}
                >
                  <ArrowLeft aria-hidden="true" />
                  返回列表
                </button>
                <button
                  className="button primary trial-view-result-button"
                  disabled={!archivedReportId || isArchiving}
                  type="button"
                  onClick={viewDetectionResult}
                >
                  <ScanSearch aria-hidden="true" />
                  {archivedReportId ? "查看结果" : "结果归档中"}
                </button>
              </ModalFooter>
            </>
          ) : detectionDialogStage === "error" ? (
            <>
              <ModalHeader className="trial-detection-error-header">
                <span className="trial-detection-modal-visual is-error" aria-hidden="true">
                  <TriangleAlert />
                </span>
                <span className="trial-detection-error-title">检测状态异常</span>
              </ModalHeader>
              <ModalBody className="trial-detection-error-body">
                <p>{detectionDialogMessage || "检测任务未能完成，请返回调整后重新发起。"}</p>
              </ModalBody>
              <ModalFooter className="trial-detection-modal-footer trial-detection-error-footer">
                <button className="button primary" type="button" onClick={() => setDetectionDialogStage(null)}>
                  确认
                </button>
              </ModalFooter>
            </>
          ) : null}
        </ModalContent>
      </Modal>
      <Modal
        classNames={{
          backdrop: "trial-version-modal-backdrop",
          base: "trial-version-modal-content",
          wrapper: "trial-version-modal-wrapper"
        }}
        disableAnimation
        hideCloseButton
        isDismissable={false}
        isKeyboardDismissDisabled
        isOpen={isVersionNoticeOpen}
        placement="center"
        size="lg"
        onOpenChange={setIsVersionNoticeOpen}
      >
        <ModalContent>
          <ModalHeader className="trial-version-modal-header">
            <span className="trial-version-modal-icon" aria-hidden="true">
              <Sparkles />
            </span>
            <div className="trial-version-modal-heading">
              <h2>选择适合您的检测方式</h2>
            </div>
          </ModalHeader>
          <ModalBody className="trial-version-modal-body">
            <p>
              当前功能适合快速体验检测流程。若需要准确率更高的检测结果与更全面的检测信息，请使用专业版检测。
            </p>
          </ModalBody>
          <ModalFooter className="trial-version-modal-footer">
            <button
              className="button secondary"
              type="button"
              onClick={() => setIsVersionNoticeOpen(false)}
            >
              继续免费体验
            </button>
            <button
              className="button primary"
              type="button"
              onClick={openProfessionalDetection}
            >
              <ScanSearch aria-hidden="true" />
              前往专业版检测
            </button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

async function readMetadataSafely(file: File) {
  try {
    return await readTrialPhotoMetadata(file);
  } catch {
    return EMPTY_TRIAL_PHOTO_METADATA;
  }
}

async function createSelectedTrialPhoto(file: File): Promise<SelectedTrialPhoto> {
  return {
    id: createTrialPhotoId(file),
    file,
    metadata: await readMetadataSafely(file),
    uploadStatus: "ready",
    uploadProgress: 0
  };
}

function createTrialPhotoId(file: File) {
  const randomId = createClientId("trial-photo");
  return `${file.name}-${file.size}-${file.lastModified}-${randomId}`;
}

function resetTrialPhotoUpload(photo: SelectedTrialPhoto): SelectedTrialPhoto {
  return {
    ...photo,
    uploadStatus: "ready",
    uploadProgress: 0,
    uploadError: undefined,
    unsupportedFormat: undefined,
    uploadedPhoto: undefined,
    generatedFile: undefined
  };
}

function photoWithUploadResult(
  photo: SelectedTrialPhoto,
  result: TrialPhotoUploadSuccess
): SelectedTrialPhoto {
  return {
    ...photo,
    metadata: metadataFromUploadedPhoto(result.uploadedPhoto, photo.metadata),
    uploadStatus: "uploaded",
    uploadProgress: 100,
    uploadError: undefined,
    unsupportedFormat: undefined,
    uploadedPhoto: result.uploadedPhoto,
    generatedFile: result.generatedFile
  };
}

function mergeTrialGeneratedResults(
  previous: TrialGeneratedResult,
  latest: TrialGeneratedResult
): TrialGeneratedResult {
  return {
    ...previous,
    ...latest,
    report_name: latest.report_name ?? previous.report_name,
    models: Array.from(new Set([...previous.models, ...latest.models])),
    files: [...previous.files, ...latest.files],
    findings: [...previous.findings, ...latest.findings],
    raw_model_outputs: [
      ...(previous.raw_model_outputs ?? []),
      ...(latest.raw_model_outputs ?? [])
    ],
    archived_report_id: latest.archived_report_id ?? previous.archived_report_id,
    archived_report_title: latest.archived_report_title ?? previous.archived_report_title
  };
}

function metadataFromUploadedPhoto(uploadedPhoto: TrialUploadedPhoto, fallback: TrialPhotoMetadata): TrialPhotoMetadata {
  const metadata = uploadedPhoto.metadata_json;
  return {
    xmpDroneDjiImageSource: typeof metadata.xmp_drone_dji_image_source === "string"
      ? metadata.xmp_drone_dji_image_source
      : fallback.xmpDroneDjiImageSource,
    ifd0ImageDescription: typeof metadata.ifd0_image_description === "string"
      ? metadata.ifd0_image_description
      : fallback.ifd0ImageDescription,
    thermalImagingAvailable: uploadedPhoto.thermal_imaging_available
  };
}

function trialUploadErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 401) return "登录状态已失效，请重新登录后上传。";
  return error instanceof Error ? error.message : "上传失败，请重新上传。";
}

function isUnsupportedTrialPhotoFormatError(error: unknown) {
  return error instanceof ApiError
    && error.status === 400
    && error.message === "图片格式与文件内容不匹配。";
}

function trialFindingSummary(findings: TrialGeneratedResult["findings"]) {
  const counts = new Map<string, number>();
  findings.forEach((finding) => {
    counts.set(finding.model, (counts.get(finding.model) ?? 0) + 1);
  });
  return Array.from(counts, ([model, count]) => ({ model, count }));
}

function isTrialResultFinding(finding: TrialGeneratedResult["findings"][number]) {
  const confidence = Number(finding.confidence);
  return Number.isFinite(confidence) && confidence > TRIAL_RESULT_CONFIDENCE_THRESHOLD;
}

function trialFindingBoxStyle(finding: TrialGeneratedResult["findings"][number]): CSSProperties | undefined {
  const bbox = finding.bbox;
  const imageWidth = Number(finding.image_width);
  const imageHeight = Number(finding.image_height);
  if (!bbox || !Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    return undefined;
  }

  const x = Number(bbox.x);
  const y = Number(bbox.y);
  const width = Number(bbox.width);
  const height = Number(bbox.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return undefined;

  const left = Math.min(imageWidth, Math.max(0, x));
  const top = Math.min(imageHeight, Math.max(0, y));
  const right = Math.min(imageWidth, Math.max(0, x + width));
  const bottom = Math.min(imageHeight, Math.max(0, y + height));
  if (right <= left || bottom <= top) return undefined;

  return {
    left: `${(left / imageWidth) * 100}%`,
    top: `${(top / imageHeight) * 100}%`,
    width: `${((right - left) / imageWidth) * 100}%`,
    height: `${((bottom - top) / imageHeight) * 100}%`,
    right: "auto",
    bottom: "auto"
  };
}

function trialFindingClass(model: string | undefined) {
  return trialDefectDisplayFromModel(model).descriptionClassName;
}
