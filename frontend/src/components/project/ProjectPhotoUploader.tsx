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
  emptyContent,
  emptyHint,
  footer,
  hasPhotos,
  inputId,
  isLoading = false,
  loadingLabel = "正在加载照片",
  containerRef,
  onFilesSelected,
  photoLayout = "grid",
  presentation = "dropzone",
  showAddButton = true,
  variant = "project"
}: {
  addDisabled?: boolean;
  children?: ReactNode;
  disabled: boolean;
  emptyContent?: ReactNode;
  emptyHint?: ReactNode;
  footer?: ReactNode;
  hasPhotos: boolean;
  inputId?: string;
  isLoading?: boolean;
  loadingLabel?: string;
  containerRef?: Ref<HTMLDivElement>;
  onFilesSelected: (files: File[]) => void;
  photoLayout?: "grid" | "paired";
  presentation?: "dropzone" | "line";
  showAddButton?: boolean;
  variant?: "project" | "trial";
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isAddDisabled = addDisabled ?? disabled;
  const rootClassName = variant === "trial" ? "trial-photo-uploader" : "project-photo-uploader";
  const gridClassName = variant === "trial"
    ? "trial-photo-grid"
    : photoLayout === "paired" ? "project-photo-pair-content" : "project-photo-grid";
  const addButtonClassName = variant === "trial" ? "trial-photo-add-button" : "project-photo-add-button";
  const emptyButtonClassName = variant === "trial" ? "trial-upload-empty" : "project-upload-empty";
  const layoutClassName = photoLayout === "paired" ? `${rootClassName}--paired` : "";
  const presentationClassName = presentation === "line" ? `${rootClassName}--line` : "";

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
      className={`${rootClassName} ${layoutClassName} ${presentationClassName} ${hasPhotos ? "has-photos" : "is-empty"}`}
      aria-live="polite"
      onDragOver={(event) => event.preventDefault()}
      onDrop={dropFiles}
    >
      <input
        ref={fileInputRef}
        id={inputId}
        className="sr-only"
        accept="image/jpeg,image/png"
        disabled={disabled}
        multiple
        type="file"
        onChange={updateFiles}
      />

      {presentation === "line" ? (
        <>
          <button
            className={`${rootClassName}-line-button`}
            disabled={isAddDisabled || isLoading}
            type="button"
            onClick={openFilePicker}
          >
            <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
              <path
                d="M8.1 4 9.6 2.5h4.8L15.9 4H19a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h3.1Z"
                fill="currentColor"
              />
              <circle cx="12" cy="12" fill="#fff" r="4.1" />
              <circle cx="12" cy="12" fill="currentColor" r="2.65" />
            </svg>
            <strong>{isLoading ? loadingLabel : "选择图片或将其拖到此处进行上传……"}</strong>
            {!isLoading && emptyHint ? (
              <span className={`${rootClassName}-line-hint`}>{emptyHint}</span>
            ) : null}
          </button>
          {hasPhotos ? <div className={gridClassName}>{children}</div> : null}
        </>
      ) : hasPhotos ? (
        <div className={gridClassName}>
          {children}
          {showAddButton ? (
            <button
              className={addButtonClassName}
              disabled={isAddDisabled}
              type="button"
              onClick={openFilePicker}
            >
              + 继续添加
            </button>
          ) : null}
        </div>
      ) : emptyContent ? (
        emptyContent
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
