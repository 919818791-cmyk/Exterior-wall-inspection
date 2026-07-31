import { ImageUp } from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  useRef
} from "react";

export function ProjectPhotoUploader({
  addDisabled,
  children,
  disabled,
  footer,
  hasPhotos,
  isLoading = false,
  loadingLabel = "正在加载照片",
  onFilesSelected
}: {
  addDisabled?: boolean;
  children?: ReactNode;
  disabled: boolean;
  footer?: ReactNode;
  hasPhotos: boolean;
  isLoading?: boolean;
  loadingLabel?: string;
  onFilesSelected: (files: File[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isAddDisabled = addDisabled ?? disabled;

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
      className={`project-photo-uploader ${hasPhotos ? "has-photos" : "is-empty"}`}
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
        <div className="project-photo-grid">
          {children}
          <button
            className="project-photo-add-button"
            disabled={isAddDisabled}
            type="button"
            onClick={openFilePicker}
          >
            + 继续添加
          </button>
        </div>
      ) : (
        <button
          className="project-upload-empty"
          disabled={disabled || isLoading}
          type="button"
          onClick={openFilePicker}
        >
          <ImageUp aria-hidden="true" />
          <strong>{isLoading ? loadingLabel : "点击或拖拽照片到此处上传"}</strong>
        </button>
      )}

      {footer}
    </div>
  );
}
