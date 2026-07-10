import { Skeleton } from "@heroui/react";
import {
  Archive,
  ChartNoAxesCombined,
  Check,
  Home,
  Images,
  ImageUp,
  RefreshCcw,
  ScanSearch,
  Sparkles,
  Trash2,
  Undo2,
  ZoomIn
} from "lucide-react";
import { type CSSProperties, type ChangeEvent, type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import {
  archiveTrialResult,
  deleteTrialPhoto,
  generateTrialResult,
  uploadTrialPhoto as uploadTrialPhotoFile,
  type TrialGeneratedResult,
  type TrialUploadedPhoto
} from "@/api/reports";
import { ModelOutputDialog } from "@/components/ModelOutputDialog";
import { TilePreviewDialog, type TilePreviewSource } from "@/components/TilePreviewDialog";
import { trialDefectBoxLabel, trialDefectDisplayFromModel } from "@/utils/trialDefectDisplay";
import { readTrialPhotoMetadata, type TrialPhotoMetadata } from "@/utils/photoMetadata";
import { createClientId } from "@/utils/id";
import { formatModelOutputs, hasModelOutputs } from "@/utils/modelOutputs";

const MODEL_OPTIONS = ["裂缝", "剥落"] as const;
const MAX_TRIAL_PHOTO_COUNT = 10;
const MAX_TRIAL_PHOTO_SIZE_BYTES = 20 * 1024 * 1024;
const TRIAL_RESULT_CONFIDENCE_THRESHOLD = 0.6;
const ACCEPTED_TRIAL_PHOTO_TYPES = new Set(["image/jpeg", "image/png"]);
const UPLOAD_LIMIT_TIP = "支持 JPG、PNG 图片，单张最大 20MB，单次最多 10 张";
const GENERATION_STEP_MESSAGES = [
  "正在读取照片信息",
  "正在调用视觉检测服务",
  "正在分析外墙缺陷区域",
  "正在生成标注结果"
] as const;
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
  uploadedPhoto?: TrialUploadedPhoto;
  generatedFile?: TrialGeneratedFile;
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

export function TrialExperiencePage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedPhotos, setSelectedPhotos] = useState<SelectedTrialPhoto[]>([]);
  const [reportName, setReportName] = useState("");
  const [error, setError] = useState("");
  const [generatedResult, setGeneratedResult] = useState<TrialGeneratedResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [archivedReportId, setArchivedReportId] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [annotatedPreview, setAnnotatedPreview] = useState<TrialAnnotatedPreview | null>(null);
  const [generationStepIndex, setGenerationStepIndex] = useState(0);
  const [isModelOutputOpen, setIsModelOutputOpen] = useState(false);
  const [tilePreview, setTilePreview] = useState<TilePreviewSource | null>(null);

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
      const modelOutput = generatedResult.raw_model_outputs?.find((item) => (
        file.photo_id ? item.photo_id === file.photo_id : item.filename === file.filename
      ));
      return {
        filename: file.filename,
        previewUrl: file.photo_id ? previewByPhotoId.get(file.photo_id) ?? "" : photoPreviews[index]?.previewUrl ?? "",
        imageWidth: modelOutput?.image_width,
        imageHeight: modelOutput?.image_height,
        tileWidth: modelOutput?.tile_width,
        tileHeight: modelOutput?.tile_height,
        tileOverlapRatio: modelOutput?.tile_overlap_ratio,
        detections: modelOutput?.detections,
        findings
      };
    });
  }, [generatedResult, photoPreviews]);
  const uploadSummary = useMemo(() => trialUploadSummary(selectedPhotos), [selectedPhotos]);
  const modelOutputText = useMemo(
    () => formatModelOutputs(generatedResult?.raw_model_outputs),
    [generatedResult?.raw_model_outputs]
  );
  const canShowModelOutputs = hasModelOutputs(generatedResult?.raw_model_outputs);
  const isUploading = selectedPhotos.some((photo) => photo.uploadStatus === "uploading");
  const isInteractionBusy = isUploading || isGenerating || isArchiving;
  const isPhotoEditingLocked = isInteractionBusy || Boolean(generatedResult) || Boolean(archivedReportId);
  const isReportNameLocked = isInteractionBusy || Boolean(archivedReportId);

  useEffect(() => () => {
    photoPreviews.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
  }, [photoPreviews]);

  useEffect(() => {
    if (!isGenerating) {
      setGenerationStepIndex(0);
      return;
    }

    const stepTimer = window.setInterval(() => {
      setGenerationStepIndex((current) => (current + 1) % GENERATION_STEP_MESSAGES.length);
    }, 1600);

    return () => {
      window.clearInterval(stepTimer);
    };
  }, [isGenerating]);

  async function applyFiles(fileList: File[]) {
    if (!fileList.length || isPhotoEditingLocked) return;

    const rejectionMessages: string[] = [];
    const selected = fileList.filter((file) => {
      const message = validateTrialPhoto(file);
      if (message) {
        rejectionMessages.push(`${file.name}: ${message}`);
        return false;
      }
      return true;
    });

    const remainingSlots = MAX_TRIAL_PHOTO_COUNT - selectedPhotos.length;
    if (remainingSlots <= 0) {
      setError(`单次最多上传 ${MAX_TRIAL_PHOTO_COUNT} 张照片。`);
      return;
    }
    const accepted = selected.slice(0, remainingSlots);
    if (!accepted.length) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      setError(rejectionMessages[0] ?? "未选择可上传的照片。");
      return;
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
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
    setGeneratedResult(null);
    setArchivedReportId(null);
    nextPhotos.forEach((photo, offset) => {
      void uploadTrialPhoto(photo, startIndex + offset);
    });
  }

  function updateFiles(event: ChangeEvent<HTMLInputElement>) {
    void applyFiles(Array.from(event.target.files ?? []));
  }

  function dropFiles(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (isPhotoEditingLocked) return;
    void applyFiles(Array.from(event.dataTransfer.files));
  }

  function openFilePicker() {
    if (isPhotoEditingLocked) return;
    fileInputRef.current?.click();
  }

  function previewPhoto(index: number) {
    setAnnotatedPreview(null);
    setPreviewIndex(index);
  }

  function previewAnnotatedPhoto(preview: TrialAnnotatedPreview) {
    if (!preview.previewUrl) return;
    setPreviewIndex(null);
    setAnnotatedPreview(preview);
  }

  async function removePhoto(index: number) {
    if (isPhotoEditingLocked) return;
    const photo = selectedPhotos[index];
    if (!photo) return;
    if (photo.uploadedPhoto) {
      try {
        await deleteTrialPhoto(photo.uploadedPhoto.id);
      } catch (deleteError) {
        const message = deleteError instanceof Error ? deleteError.message : "删除照片失败。";
        setError(message);
        return;
      }
    }
    setSelectedPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index));
    setPreviewIndex((current) => (
      current === null ? null : current === index ? null : current > index ? current - 1 : current
    ));
    setGeneratedResult(null);
    setArchivedReportId(null);
    setError("");
  }

  function closePhotoPreview() {
    setPreviewIndex(null);
    setAnnotatedPreview(null);
  }

  function updateReportName(value: string) {
    setReportName(value);
    setError("");
  }

  async function discardGeneratedResult() {
    if (archivedReportId) return;
    const uploadedPhotoIds = selectedPhotos
      .map((photo) => photo.uploadedPhoto?.id)
      .filter((photoId): photoId is string => Boolean(photoId));
    try {
      await Promise.all(uploadedPhotoIds.map((photoId) => deleteTrialPhoto(photoId)));
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : "撤销失败，请稍后重试。";
      setError(message);
      return;
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    setSelectedPhotos([]);
    setGeneratedResult(null);
    setPreviewIndex(null);
    setError("");
  }

  async function generateReport() {
    if (!selectedPhotos.length) {
      setError("请先上传照片。");
      return;
    }

    if (isUploading) {
      setError("照片正在上传，请等待上传完成。");
      return;
    }

    const failedCount = selectedPhotos.filter((photo) => photo.uploadStatus === "failed").length;
    if (failedCount) {
      setError(`${failedCount} 张照片上传失败，请先单张重新上传。`);
      return;
    }

    const photoIds = selectedPhotos
      .map((photo) => photo.uploadedPhoto?.id)
      .filter((photoId): photoId is string => Boolean(photoId));
    if (photoIds.length !== selectedPhotos.length) {
      setError("请等待照片上传完成。");
      return;
    }

    setIsGenerating(true);
    setArchivedReportId(null);
    setError("");
    try {
      const generated = await generateTrialResult({
        report_name: reportName.trim() || undefined,
        models: [...MODEL_OPTIONS],
        photo_ids: photoIds
      });
      setGeneratedResult(generated);
    } catch (generateError) {
      const message = generateError instanceof ApiError && generateError.status === 401
        ? "请先登录后再生成检测结果。"
        : generateError instanceof Error ? generateError.message : "生成检测结果失败。";
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  }

  async function retryPhoto(index: number) {
    const photo = selectedPhotos[index];
    if (!photo || isPhotoEditingLocked) return;

    setArchivedReportId(null);
    setGeneratedResult(null);
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
      const uploadedPhoto = await uploadTrialPhotoFile(photo.file, (progress) => {
        setSelectedPhotos((current) => current.map((currentPhoto) => (
          currentPhoto.id === photo.id
            ? { ...currentPhoto, uploadProgress: progress.percent }
          : currentPhoto
        )));
      });

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
          ? { ...currentPhoto, uploadStatus: "failed", uploadError: message }
          : currentPhoto
      )));
      return null;
    }
  }

  async function archiveGeneratedResult() {
    if (!generatedResult) {
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
        ...generatedResult,
        report_name: reportName.trim() || undefined,
        findings: generatedResult.findings.filter(isTrialResultFinding)
      });
      setArchivedReportId(archivedResult.id);
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

  return (
    <>
      <div className="trial-experience-shell trial-experience-content-shell trial-live-shell">
        <section className="trial-experience-grid">
          <div className="trial-upload-panel">
            <label className="trial-report-name-field">
              <span>报告名称</span>
              <input
                disabled={isReportNameLocked}
                maxLength={255}
                placeholder="请输入报告名称"
                value={reportName}
                onChange={(event) => updateReportName(event.target.value)}
              />
            </label>
            <div
              className={`trial-photo-uploader ${photoPreviews.length ? "has-photos" : "is-empty"}`}
              aria-live="polite"
              onDragOver={(event) => event.preventDefault()}
              onDrop={dropFiles}
            >
              <input
                ref={fileInputRef}
                className="sr-only"
                accept="image/jpeg,image/png"
                disabled={isPhotoEditingLocked}
                multiple
                type="file"
                onChange={updateFiles}
              />
              {photoPreviews.length ? (
                <>
                  <div className="trial-photo-grid">
                    {photoPreviews.map((photo, index) => {
                      const photoProgress = clampProgress(photo.uploadProgress);
                      const thermalAvailable = photo.uploadStatus === "uploaded"
                        && (photo.uploadedPhoto?.thermal_imaging_available ?? photo.metadata.thermalImagingAvailable);
                      return (
                        <figure
                          key={photo.id}
                          className={`trial-photo-thumb is-${photo.uploadStatus}`}
                        >
                          <div className="trial-photo-thumb-image">
                            <img alt={photo.file.name} src={photo.previewUrl} />
                            {thermalAvailable ? (
                              <span className="trial-thermal-available-tag">热成像可用</span>
                            ) : null}
                            {photo.uploadStatus === "uploaded" ? (
                              <span className="trial-photo-check"><Check aria-hidden="true" /></span>
                            ) : null}
                            {photo.uploadStatus === "uploaded" ? (
                              <div className="trial-photo-thumb-actions">
                                <button
                                  type="button"
                                  aria-label="放大看"
                                  title="放大看"
                                  onClick={() => previewPhoto(index)}
                                >
                                  <ZoomIn aria-hidden="true" />
                                </button>
                                <button
                                  className="danger"
                                  disabled={isPhotoEditingLocked}
                                  type="button"
                                  aria-label="删除"
                                  title="删除"
                                  onClick={() => void removePhoto(index)}
                                >
                                  <Trash2 aria-hidden="true" />
                                </button>
                              </div>
                            ) : null}
                          </div>
                          <figcaption>{photo.file.name}</figcaption>
                          <div className="trial-photo-progress" aria-label={`${photo.file.name} 上传进度`}>
                            <div className="trial-photo-progress-meta">
                              <span>{trialPhotoStatusLabel(photo)}</span>
                              <strong>{photoProgress}%</strong>
                            </div>
                            <div
                              className="trial-progress-track"
                              role="progressbar"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={photoProgress}
                            >
                              <span
                                className="trial-progress-fill"
                                style={{ width: `${photoProgress}%` }}
                              />
                            </div>
                          </div>
                          {photo.uploadStatus === "failed" ? (
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
                        </figure>
                      );
                    })}
                    <button
                      className="trial-photo-add-button"
                      disabled={isPhotoEditingLocked}
                      type="button"
                      onClick={openFilePicker}
                    >
                      + 继续添加
                    </button>
                  </div>
                  <div className={`trial-uploader-progress-footer ${uploadSummary.failedCount ? "has-error" : ""}`}>
                    <div className="trial-uploader-progress-head">
                      <span>{uploadSummary.label}</span>
                      <strong>{uploadSummary.percent}%</strong>
                    </div>
                    <div
                      className="trial-progress-track"
                      role="progressbar"
                      aria-label="照片上传总进度"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={uploadSummary.percent}
                    >
                      <span
                        className="trial-progress-fill"
                        style={{ width: `${uploadSummary.percent}%` }}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <button
                  className="trial-upload-empty"
                  disabled={isPhotoEditingLocked}
                  type="button"
                  onClick={openFilePicker}
                >
                  <ImageUp aria-hidden="true" />
                  <strong>点击或拖拽照片到此处上传</strong>
                  <span className="trial-upload-note">{UPLOAD_LIMIT_TIP}</span>
                </button>
              )}
            </div>
            {error ? <p className="trial-error">{error}</p> : null}
            {archivedReportId ? <p className="trial-status-message">已存档到检测结果页。</p> : null}
            <div className="trial-actions">
              {generatedResult ? (
                <>
                  <button
                    className="button primary"
                    disabled={isGenerating || isArchiving || Boolean(archivedReportId)}
                    type="button"
                    onClick={() => void archiveGeneratedResult()}
                  >
                    <Archive aria-hidden="true" />
                    {isArchiving ? "存档中" : archivedReportId ? "已存档" : "存档"}
                  </button>
                  <button
                    className="button secondary"
                    disabled={isGenerating || isArchiving || Boolean(archivedReportId)}
                    type="button"
                    onClick={() => void discardGeneratedResult()}
                  >
                    <Undo2 aria-hidden="true" />
                    撤销
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="button primary"
                    disabled={isPhotoEditingLocked}
                    type="button"
                    onClick={() => void generateReport()}
                  >
                    <Sparkles aria-hidden="true" />
                    {isGenerating ? "生成中" : "生成检测结果"}
                  </button>
                  <Link className="button secondary" to="/">
                    <Home aria-hidden="true" />
                    取消并返回
                  </Link>
                </>
              )}
            </div>
          </div>
          <aside className="trial-report-panel">
            {generatedResult ? (
              <div className="trial-report-result">
                <div className="trial-report-head">
                  <div className="trial-report-title-row">
                    <h2>检测结果明细</h2>
                    {canShowModelOutputs ? (
                      <button
                        className="model-output-link"
                        type="button"
                        onClick={() => setIsModelOutputOpen(true)}
                      >
                        模型原始输出
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="trial-report-table-wrap">
                  <table className="trial-report-table">
                    <thead>
                      <tr>
                        <th>序号</th>
                        <th>含标注的照片</th>
                        <th>检测说明</th>
                        <th>tile</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportRows.map((row, index) => (
                        <tr key={`finding-${row.filename}-${index}`}>
                          <td>
                            <span className="trial-report-index">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                          </td>
                          <td>
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
                                        {trialDefectBoxLabel(display, finding.confidence)}
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
                          <td className="trial-tile-column">
                            <button
                              className="trial-tile-view-button"
                              disabled={!row.previewUrl}
                              type="button"
                              onClick={() => setTilePreview({
                                filename: row.filename,
                                imageUrl: row.previewUrl,
                                imageWidth: row.imageWidth,
                                imageHeight: row.imageHeight,
                                tileWidth: row.tileWidth,
                                tileHeight: row.tileHeight,
                                tileOverlapRatio: row.tileOverlapRatio,
                                detections: row.detections
                              })}
                            >
                              查看tile
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : isGenerating ? (
              <TrialGeneratingResult
                photos={photoPreviews}
                stepIndex={generationStepIndex}
              />
            ) : (
              <div className="trial-report-empty">
                <div className="trial-report-empty-content">
                  <div className="trial-report-empty-illustration" aria-hidden="true">
                    <img src="/images/capabilities/等待报告图案.jpeg" alt="" />
                  </div>
                  <h2>等待生成结果</h2>
                  <p>上传外墙照片并选择检测类型，即可生成智能检测结果。</p>
                </div>
              </div>
            )}
          </aside>
          <aside className="trial-guide-panel" aria-labelledby="trial-guide-title">
            <div className="trial-guide-heading">
              <h2 id="trial-guide-title">示例说明</h2>
            </div>
            <div className="trial-guide-list">
              <article className="trial-guide-card trial-guide-card-detection">
                <span className="trial-guide-icon" aria-hidden="true">
                  <ScanSearch />
                </span>
                <div>
                  <h3>支持检测类型</h3>
                  <p>体验版目前支持两类常见外墙缺陷识别</p>
                  <div className="trial-guide-tags" aria-label="支持裂缝检测和剥落检测">
                    <span>裂缝检测</span>
                    <span>剥落检测</span>
                  </div>
                </div>
              </article>
              <article className="trial-guide-card trial-guide-card-photo">
                <span className="trial-guide-icon" aria-hidden="true">
                  <Images />
                </span>
                <div>
                  <h3>照片建议</h3>
                  <p>正面拍摄完整墙面，保持画面清晰、光线均匀并避免遮挡。</p>
                  <div className="trial-guide-tags" aria-label="照片建议：清晰、完整、无遮挡">
                    <span>画面清晰</span>
                    <span>墙面完整</span>
                    <span>无遮挡</span>
                  </div>
                </div>
              </article>
              <article className="trial-guide-card trial-guide-card-output">
                <span className="trial-guide-icon" aria-hidden="true">
                  <ChartNoAxesCombined />
                </span>
                <div>
                  <h3>输出内容</h3>
                  <p>检测结果将直观呈现缺陷位置及识别信息</p>
                  <div className="trial-guide-tags" aria-label="输出缺陷位置、缺陷类型和置信度">
                    <span>缺陷位置</span>
                    <span>缺陷类型</span>
                    <span>置信度</span>
                  </div>
                </div>
              </article>
              <article className="trial-guide-card trial-guide-example-card">
                <h3>原图示例</h3>
                <div className="trial-guide-example-images">
                  <div className="trial-guide-example-image-frame">
                    <img
                      alt="空鼓检测原图示例"
                      loading="lazy"
                      src="/images/trial/空鼓原图.JPG"
                    />
                  </div>
                  <div className="trial-guide-example-image-frame">
                    <img
                      alt="裂缝检测原图示例"
                      loading="lazy"
                      src="/images/trial/裂缝原图.jpeg"
                    />
                  </div>
                </div>
              </article>
              <article className="trial-guide-card trial-guide-example-card">
                <h3>标注示例</h3>
                <div className="trial-guide-example-images">
                  <div className="trial-guide-example-image-frame">
                    <img
                      alt="空鼓检测标注结果示例"
                      loading="lazy"
                      src="/images/trial/空鼓检测结果图.png"
                    />
                  </div>
                  <div className="trial-guide-example-image-frame">
                    <img
                      alt="裂缝检测标注结果示例"
                      loading="lazy"
                      src="/images/trial/裂缝结果图l.jpeg"
                    />
                  </div>
                </div>
              </article>
            </div>
          </aside>
        </section>
      </div>
      {previewingPhoto || annotatedPreview ? (
        <div
          className="trial-photo-preview-modal"
          role="dialog"
          aria-modal="true"
          aria-label="照片预览"
          onClick={closePhotoPreview}
        >
          <figure onClick={(event) => event.stopPropagation()}>
            {annotatedPreview ? (
              <div className="trial-annotated-photo trial-photo-preview-annotated">
                <img alt={`${annotatedPreview.filename} 检测标注预览`} src={annotatedPreview.previewUrl} />
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
                        {trialDefectBoxLabel(display, finding.confidence)}
                      </span>
                    </span>
                  );
                })}
              </div>
            ) : previewingPhoto ? (
              <img alt={previewingPhoto.file.name} src={previewingPhoto.previewUrl} />
            ) : null}
            <figcaption>{annotatedPreview?.filename ?? previewingPhoto?.file.name}</figcaption>
          </figure>
        </div>
      ) : null}
      {isModelOutputOpen ? (
        <ModelOutputDialog
          text={modelOutputText}
          onClose={() => setIsModelOutputOpen(false)}
        />
      ) : null}
      {tilePreview ? (
        <TilePreviewDialog source={tilePreview} onClose={() => setTilePreview(null)} />
      ) : null}
    </>
  );
}

function TrialGeneratingResult({
  photos,
  stepIndex
}: {
  photos: SelectedPhotoPreview[];
  stepIndex: number;
}) {
  const rows = photos.length
    ? photos.map((photo) => ({
      id: photo.id,
      filename: photo.file.name,
      previewUrl: photo.previewUrl
    }))
    : Array.from({ length: 3 }, (_, index) => ({
      id: `placeholder-${index}`,
      filename: "",
      previewUrl: ""
    }));

  return (
    <div
      className="trial-report-result trial-generating-result"
      role="status"
      aria-live="polite"
      aria-label="检测结果生成中"
    >
      <div className="trial-report-head trial-generating-head">
        <h2>检测结果明细</h2>
      </div>
      <div className="trial-report-table-wrap trial-generating-table-wrap">
        <table className="trial-report-table trial-generating-table" aria-busy="true">
          <thead>
            <tr>
              <th>序号</th>
              <th>含标注的照片</th>
              <th>检测说明</th>
              <th>tile</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const message = GENERATION_STEP_MESSAGES[(stepIndex + index) % GENERATION_STEP_MESSAGES.length];
              return (
                <tr key={row.id}>
                  <td>
                    <span className="trial-generating-index">{String(index + 1).padStart(2, "0")}</span>
                  </td>
                  <td>
                    <figure className="trial-annotated-photo-frame trial-generating-photo-frame">
                      <div className={`trial-generating-photo ${row.previewUrl ? "has-preview" : ""}`}>
                        {row.previewUrl ? (
                          <img alt={`${row.filename} 正在检测`} src={row.previewUrl} />
                        ) : (
                          <Skeleton className="trial-generating-photo-skeleton" />
                        )}
                        <span className="trial-generating-scan-line" aria-hidden="true" />
                      </div>
                      {row.filename ? (
                        <figcaption>{row.filename}</figcaption>
                      ) : (
                        <Skeleton className="trial-generating-caption-skeleton" />
                      )}
                    </figure>
                  </td>
                  <td className="trial-report-description trial-generating-description">
                    <div className="trial-generating-description-stack">
                      <span className="trial-generating-message">
                        {message}
                        <span className="trial-loading-dots" aria-hidden="true">
                          <span>.</span>
                          <span>.</span>
                          <span>.</span>
                        </span>
                      </span>
                      <Skeleton className="trial-generating-line is-wide" />
                      <Skeleton className="trial-generating-line is-short" />
                    </div>
                  </td>
                  <td className="trial-tile-column">
                    <button
                      className="trial-tile-view-button"
                      disabled
                      type="button"
                    >
                      生成中
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
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

function validateTrialPhoto(file: File) {
  if (!ACCEPTED_TRIAL_PHOTO_TYPES.has(file.type)) return "仅支持 JPG、PNG 图片。";
  if (file.size > MAX_TRIAL_PHOTO_SIZE_BYTES) return "单张图片最大 20MB。";
  return "";
}

function resetTrialPhotoUpload(photo: SelectedTrialPhoto): SelectedTrialPhoto {
  return {
    ...photo,
    uploadStatus: "ready",
    uploadProgress: 0,
    uploadError: undefined,
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
    uploadedPhoto: result.uploadedPhoto,
    generatedFile: result.generatedFile
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

function trialUploadSummary(photos: SelectedTrialPhoto[]) {
  const totalBytes = photos.reduce((sum, photo) => sum + Math.max(photo.file.size, 1), 0);
  const uploadedBytes = photos.reduce(
    (sum, photo) => sum + Math.max(photo.file.size, 1) * (clampProgress(photo.uploadProgress) / 100),
    0
  );
  const uploadedCount = photos.filter((photo) => photo.uploadStatus === "uploaded").length;
  const uploadingCount = photos.filter((photo) => photo.uploadStatus === "uploading").length;
  const failedCount = photos.filter((photo) => photo.uploadStatus === "failed").length;
  const percent = totalBytes ? Math.round((uploadedBytes / totalBytes) * 100) : 0;
  return {
    failedCount,
    percent: clampProgress(percent),
    label: uploadSummaryLabel({
      totalCount: photos.length,
      uploadedCount,
      uploadingCount,
      failedCount
    })
  };
}

function uploadSummaryLabel({
  totalCount,
  uploadedCount,
  uploadingCount,
  failedCount
}: {
  totalCount: number;
  uploadedCount: number;
  uploadingCount: number;
  failedCount: number;
}) {
  if (uploadingCount) return `正在上传 ${uploadingCount} 张，已完成 ${uploadedCount}/${totalCount}`;
  if (failedCount) return `${failedCount} 张上传失败，可单张重新上传`;
  if (totalCount && uploadedCount === totalCount) return `上传完成 ${uploadedCount}/${totalCount}`;
  return `等待上传 0/${totalCount}`;
}

function trialPhotoStatusLabel(photo: SelectedTrialPhoto) {
  if (photo.uploadStatus === "uploading") return "上传中";
  if (photo.uploadStatus === "uploaded") return "上传完成";
  if (photo.uploadStatus === "failed") return "上传失败";
  return "等待上传";
}

function clampProgress(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function trialUploadErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 401) return "登录状态已失效，请重新登录后上传。";
  return error instanceof Error ? error.message : "上传失败，请重新上传。";
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
  const imageWidth = finding.image_width;
  const imageHeight = finding.image_height;
  if (!bbox || !imageWidth || !imageHeight) return undefined;
  return {
    left: `${(bbox.x / imageWidth) * 100}%`,
    top: `${(bbox.y / imageHeight) * 100}%`,
    width: `${(bbox.width / imageWidth) * 100}%`,
    height: `${(bbox.height / imageHeight) * 100}%`,
    right: "auto",
    bottom: "auto"
  };
}

function trialFindingClass(model: string | undefined) {
  return trialDefectDisplayFromModel(model).descriptionClassName;
}
