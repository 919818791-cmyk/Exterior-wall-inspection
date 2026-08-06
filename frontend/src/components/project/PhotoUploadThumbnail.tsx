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
  precheckReason,
  precheckStatus,
  previewUrl,
  removeDisabled = false,
  removeLabel,
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
  precheckReason?: string | null;
  precheckStatus?: PhotoPrecheckStatus | null;
  previewUrl?: string | null;
  removeDisabled?: boolean;
  removeLabel?: string;
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
  const warningLabel = unsupportedFormat
    ? "不支持此格式"
    : precheckStatus === "rejected" ? "非建筑照片！" : "预检失败";

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
        {onRemove ? (
          <button
            aria-label={removeLabel ?? `删除 ${fileName}`}
            className="new-project-photo-remove"
            disabled={removeDisabled}
            title={removeLabel ?? "删除"}
            type="button"
            onClick={onRemove}
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <figcaption>{fileName}</figcaption>
      {footer}
    </figure>
  );
}
