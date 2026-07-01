import { Archive, Check, FileSearch, Home, ImageUp, Sparkles, Trash2, Undo2, X, ZoomIn } from "lucide-react";
import { type ChangeEvent, type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { archiveTrialResult, generateTrialResult, type TrialGeneratedResult } from "@/api/reports";
import { readTrialPhotoMetadata, type TrialPhotoMetadata } from "@/utils/photoMetadata";

const MODEL_OPTIONS = ["裂缝", "剥落"] as const;
const UPLOAD_LIMIT_TIP = "支持 JPG、PNG 图片，单张最大 20MB，单次最多 20 张";
const EMPTY_TRIAL_PHOTO_METADATA: TrialPhotoMetadata = {
  xmpDroneDjiImageSource: null,
  ifd0ImageDescription: null,
  thermalImagingAvailable: false
};

interface SelectedTrialPhoto {
  file: File;
  metadata: TrialPhotoMetadata;
}

interface SelectedPhotoPreview extends SelectedTrialPhoto {
  previewUrl: string;
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

  const photoPreviews = useMemo<SelectedPhotoPreview[]>(
    () => selectedPhotos.map((photo) => ({
      ...photo,
      previewUrl: URL.createObjectURL(photo.file)
    })),
    [selectedPhotos]
  );
  const reportRows = useMemo(
    () => generatedResult
      ? generatedResult.files.map((file, index) => ({
        filename: file.filename,
        previewUrl: photoPreviews[index]?.previewUrl ?? "",
        finding: generatedResult.findings[index] ?? generatedResult.findings.find((item) => item.filename === file.filename)
      }))
      : [],
    [generatedResult, photoPreviews]
  );

  useEffect(() => () => {
    photoPreviews.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
  }, [photoPreviews]);

  async function applyFiles(fileList: File[]) {
    if (!fileList.length) return;
    const selected = fileList.filter((file) => file.type.startsWith("image/"));
    if (selected.length !== fileList.length) {
      setError("仅支持图片文件。");
      return;
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
    setError("");

    const nextPhotos = await Promise.all(
      selected.map(async (file) => ({
        file,
        metadata: await readMetadataSafely(file)
      }))
    );

    setSelectedPhotos((current) => [...current, ...nextPhotos]);
    setGeneratedResult(null);
    setArchivedReportId(null);
  }

  function updateFiles(event: ChangeEvent<HTMLInputElement>) {
    void applyFiles(Array.from(event.target.files ?? []));
  }

  function dropFiles(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void applyFiles(Array.from(event.dataTransfer.files));
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function previewPhoto(index: number) {
    setPreviewIndex(index);
  }

  function removePhoto(index: number) {
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
  }

  function updateReportName(value: string) {
    setReportName(value);
    setGeneratedResult(null);
    setArchivedReportId(null);
    setError("");
  }

  function discardGeneratedResult() {
    if (archivedReportId) return;
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

    const files = selectedPhotos.map((photo) => photo.file);

    setIsGenerating(true);
    setArchivedReportId(null);
    setError("");
    try {
      const result = await generateTrialResult({
        report_name: reportName.trim() || undefined,
        models: [...MODEL_OPTIONS],
      }, files);
      setGeneratedResult(result);
    } catch (generateError) {
      const message = generateError instanceof Error ? generateError.message : "生成检测结果失败。";
      setError(message);
    } finally {
      setIsGenerating(false);
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
      const archivedResult = await archiveTrialResult(generatedResult, selectedPhotos.map((photo) => photo.file));
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
      <div className="trial-experience-shell trial-experience-content-shell">
        <section className="trial-experience-grid">
          <div className="trial-upload-panel">
            <label className="trial-report-name-field">
              <span>报告名称</span>
              <input
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
                multiple
                type="file"
                onChange={updateFiles}
              />
              {photoPreviews.length ? (
                <div className="trial-photo-grid">
                  {photoPreviews.map((photo, index) => (
                    <figure
                      key={`${photo.file.name}-${photo.file.size}-${photo.file.lastModified}-${index}`}
                      className="trial-photo-thumb"
                    >
                      <div className="trial-photo-thumb-image">
                        <img alt={photo.file.name} src={photo.previewUrl} />
                        {photo.metadata.thermalImagingAvailable ? (
                          <span className="trial-hollow-available-tag">空鼓可用</span>
                        ) : null}
                        <span className="trial-photo-check"><Check aria-hidden="true" /></span>
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
                            type="button"
                            aria-label="删除"
                            title="删除"
                            onClick={() => removePhoto(index)}
                          >
                            <Trash2 aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      <figcaption>{photo.file.name}</figcaption>
                    </figure>
                  ))}
                  <button className="trial-photo-add-button" type="button" onClick={openFilePicker}>
                    + 继续添加
                  </button>
                </div>
              ) : (
                <button className="trial-upload-empty" type="button" onClick={openFilePicker}>
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
                    onClick={discardGeneratedResult}
                  >
                    <Undo2 aria-hidden="true" />
                    撤销
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="button primary"
                    disabled={isGenerating || isArchiving}
                    type="button"
                    onClick={() => void generateReport()}
                  >
                    <Sparkles aria-hidden="true" />
                    {isGenerating ? "生成中" : "生成检测结果"}
                  </button>
                  <Link className="button secondary" to="/">
                    <Home aria-hidden="true" />
                    返回首页
                  </Link>
                </>
              )}
            </div>
          </div>
          <aside className="trial-report-panel">
            {generatedResult ? (
              <div className="trial-report-result">
                <div className="trial-report-head">
                  <div>
                    <h2>检测结果明细</h2>
                  </div>
                </div>
                <div className="trial-report-table-wrap">
                  <table className="trial-report-table">
                    <thead>
                      <tr>
                        <th>序号</th>
                        <th>含标注的照片</th>
                        <th>检测说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportRows.map((row, index) => (
                        <tr key={`finding-${row.filename}-${index}`}>
                          <td>{String(index + 1).padStart(2, "0")}</td>
                          <td>
                            <figure className="trial-annotated-photo-frame">
                              <div className="trial-annotated-photo">
                                <img alt={`${row.filename} 检测标注`} src={row.previewUrl} />
                                <span className={`trial-defect-box trial-defect-box-${index % 3}`} />
                              </div>
                              <figcaption>{row.filename}</figcaption>
                            </figure>
                          </td>
                          <td className="trial-report-description">
                            <p>
                              <span className={trialFindingClass(row.finding?.model)}>
                                疑似{row.finding?.model || "缺陷"}: 1处
                              </span>
                            </p>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="trial-report-empty">
                <FileSearch aria-hidden="true" />
                <h2>等待生成结果</h2>
                <p>选择图片后点击“生成检测结果”。</p>
              </div>
            )}
          </aside>
        </section>
      </div>
      {previewingPhoto ? (
        <div
          className="trial-photo-preview-modal"
          role="dialog"
          aria-modal="true"
          aria-label="照片预览"
          onClick={closePhotoPreview}
        >
          <figure onClick={(event) => event.stopPropagation()}>
            <button
              className="trial-photo-preview-close"
              type="button"
              aria-label="关闭预览"
              onClick={closePhotoPreview}
            >
              <X aria-hidden="true" />
            </button>
            <img alt={previewingPhoto.file.name} src={previewingPhoto.previewUrl} />
            <figcaption>{previewingPhoto.file.name}</figcaption>
          </figure>
        </div>
      ) : null}
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

function trialFindingClass(model: string | undefined) {
  return model?.includes("剥落")
    ? "trial-report-description-spalling"
    : "trial-report-description-crack";
}
