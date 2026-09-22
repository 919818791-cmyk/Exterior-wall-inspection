import { ImageOff, X } from "lucide-react";
import type { ReactNode } from "react";

import type { PhotoPrecheckStatus } from "@/types/projects";
import { hasPhotoPrecheckIssue } from "@/utils/photoUpload";

export function PhotoUploadThumbnail({
  badges,
  children,
  fileName,
  footer,
  onPreview,
  onRemove,
  precheckCategory,
  precheckReason,
  precheckStatus,
  previewUrl,
  removeDisabled = false,
  removeLabel,
  removePlacement = "overlay",
  statusClassName,
  unsupportedFormat = false,
  variant = "project"
}: {
  badges?: ReactNode;
  children?: ReactNode;
  fileName: string;
  footer?: ReactNode;
  onPreview?: () => void;
  onRemove?: () => void;
  precheckCategory?: string | null;
  precheckReason?: string | null;
  precheckStatus?: PhotoPrecheckStatus | null;
  previewUrl?: string | null;
  removeDisabled?: boolean;
  removeLabel?: string;
  removePlacement?: "overlay" | "footer";
  statusClassName?: string;
  unsupportedFormat?: boolean;
  variant?: "project" | "trial";
}) {
  const hasPrecheckWarning = hasPhotoPrecheckIssue(precheckStatus);
  const hasPhotoWarning = hasPrecheckWarning || unsupportedFormat;
  const isPreviewable = Boolean(previewUrl && onPreview);
  const variantClassName = variant === "trial" ? "trial-photo-thumb" : "project-photo-thumb";
  const imageClassName = variant === "trial" ? "trial-photo-thumb-image" : "project-photo-thumb-image";
  const precheckClassName = precheckStatus ? `precheck-${precheckStatus}` : "";
  const isNonDronePhoto = precheckCategory === "NON_DRONE";
  const warningLabel = unsupportedFormat
    ? "不支持此格式"
    : precheckStatus === "rejected"
      ? isNonDronePhoto ? "非无人机照片！" : "非建筑照片！"
      : "预检失败";
  const removeButton = onRemove ? (
    <button
      aria-label={removeLabel ?? `删除 ${fileName}`}
      className="new-project-photo-remove"
      disabled={removeDisabled}
      title={removeLabel ?? "删除"}
      type="button"
      onClick={onRemove}
    >
      {removePlacement === "footer" ? (
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path d="M8 3h8l1 2h3v2H4V5h3l1-2Zm-1 6h10l-.72 12H7.72L7 9Z" fill="currentColor" />
        </svg>
      ) : <X aria-hidden="true" />}
    </button>
  ) : null;

  return (
    <figure
      className={[
        "photo-upload-thumbnail",
        variantClassName,
        statusClassName,
        precheckClassName,
        unsupportedFormat ? "is-unsupported-format" : "",
        isPreviewable ? "is-previewable" : ""
      ].filter(Boolean).join(" ")}
    >
      <div
        className={`photo-upload-thumbnail-image ${imageClassName}`}
        aria-label={isPreviewable ? `查看大图 ${fileName}` : undefined}
        role={isPreviewable ? "button" : undefined}
        tabIndex={isPreviewable ? 0 : undefined}
        onClick={(event) => {
          if (!isPreviewable || (event.target instanceof Element && event.target.closest("button"))) return;
          onPreview?.();
        }}
        onKeyDown={(event) => {
          if (isPreviewable && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onPreview?.();
          }
        }}
      >
        {previewUrl
          ? <img alt={fileName} src={previewUrl} />
          : <span className="project-photo-missing"><ImageOff aria-hidden="true" /></span>}
        {badges}
        {hasPhotoWarning ? (
          <span
            aria-label={`${fileName}${warningLabel}${precheckReason && !unsupportedFormat ? `：${precheckReason}` : ""}`}
            className="photo-upload-precheck-alert"
            role="status"
            title={unsupportedFormat ? warningLabel : precheckReason ?? warningLabel}
          >
            {warningLabel}
          </span>
        ) : null}
        {children}
        {removePlacement === "overlay" ? removeButton : null}
      </div>
      {removePlacement === "footer" ? (
        <div className="photo-upload-thumbnail-footer">
          <figcaption title={fileName}>{fileName}</figcaption>
          {removeButton}
        </div>
      ) : <figcaption title={fileName}>{fileName}</figcaption>}
      {footer}
    </figure>
  );
}
