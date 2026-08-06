import { ImageUp } from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  type Ref,
  type ReactNode,
  useRef
} from "react";

export function ProjectPhotoUploader({
  addDisabled,
  children,
  disabled,
  emptyHint,
  footer,
  hasPhotos,
  isLoading = false,
  loadingLabel = "正在加载照片",
  containerRef,
  onFilesSelected,
  variant = "project"
}: {
  addDisabled?: boolean;
  children?: ReactNode;
  disabled: boolean;
  emptyHint?: ReactNode;
  footer?: ReactNode;
  hasPhotos: boolean;
  isLoading?: boolean;
  loadingLabel?: string;
  containerRef?: Ref<HTMLDivElement>;
  onFilesSelected: (files: File[]) => void;
  variant?: "project" | "trial";
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isAddDisabled = addDisabled ?? disabled;
  const rootClassName = variant === "trial" ? "trial-photo-uploader" : "project-photo-uploader";
  const gridClassName = variant === "trial" ? "trial-photo-grid" : "project-photo-grid";
  const addButtonClassName = variant === "trial" ? "trial-photo-add-button" : "project-photo-add-button";
  const emptyButtonClassName = variant === "trial" ? "trial-upload-empty" : "project-upload-empty";

  const openFilePicker = () => {
    if (disabled) return;
    fileInputRef.current?.click();
  };

  const updateFiles = (event: ChangeEvent<HTMLInputElement>) => {
    onFilesSelected(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (disabled) return;
    onFilesSelected(Array.from(event.dataTransfer.files));
  };

  return (
    <div
      ref={containerRef}
      className={`${rootClassName} ${hasPhotos ? "has-photos" : "is-empty"}`}
      aria-live="polite"
      onDragOver={(event) => event.preventDefault()}
      onDrop={dropFiles}
    >
      <input
        ref={fileInputRef}
        className="sr-only"
        accept="image/jpeg,image/png"
        disabled={disabled}
        multiple
        type="file"
        onChange={updateFiles}
      />

      {hasPhotos ? (
        <div className={gridClassName}>
          {children}
          <button
            className={addButtonClassName}
            disabled={isAddDisabled}
            type="button"
            onClick={openFilePicker}
          >
            + 继续添加
          </button>
        </div>
      ) : (
        <button
          className={emptyButtonClassName}
          disabled={disabled || isLoading}
          type="button"
          onClick={openFilePicker}
        >
          <ImageUp aria-hidden="true" />
          <strong>{isLoading ? loadingLabel : "点击或拖拽照片到此处上传"}</strong>
          {!isLoading && emptyHint ? emptyHint : null}
        </button>
      )}

      {footer}
    </div>
  );
}
