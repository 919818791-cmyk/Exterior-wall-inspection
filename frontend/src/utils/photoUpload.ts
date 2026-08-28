import type { PhotoPrecheckStatus } from "@/types/projects";

const ACCEPTED_PHOTO_TYPES = new Set(["image/jpeg", "image/png"]);

export const MAX_PROJECT_PHOTO_COUNT = 30;
export const MAX_PROJECT_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
export const PHOTO_UPLOAD_WINDOW_WARNING = "上传过程中请勿关闭此窗口";

export function hasPhotoPrecheckIssue(status?: PhotoPrecheckStatus | null) {
  return status === "rejected" || status === "error";
}

export function validatePhotoUpload(
  file: File,
  options: { maxSizeBytes?: number } = {}
) {
  if (!ACCEPTED_PHOTO_TYPES.has(file.type)) return "仅支持 JPG、PNG 图片。";
  if (!file.size) return "图片内容为空。";
  if (options.maxSizeBytes && file.size > options.maxSizeBytes) {
    return `单张图片最大 ${Math.floor(options.maxSizeBytes / 1024 / 1024)}MB。`;
  }
  return "";
}
