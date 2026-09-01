import type { ManagedAnnotation } from "@/types/reviewAnnotations";
import { createClientId } from "@/utils/id";

export interface AnnotationImportPhoto {
  key: string;
  filename: string;
  imageWidth: number | null;
  imageHeight: number | null;
}

export interface AnnotationImportMatch {
  photoKey: string;
  filename: string;
  annotations: ManagedAnnotation[];
}

export interface AnnotationImportParseResult {
  matches: AnnotationImportMatch[];
  unmatchedPhotoNames: string[];
}

interface ImportDimensions {
  width: number | null;
  height: number | null;
}

interface RawAnnotation {
  value: Record<string, unknown>;
  dimensions: ImportDimensions;
}

interface RawPhotoGroup {
  photoName: string;
  annotations: RawAnnotation[];
}

const COLLECTION_KEYS = [
  "annotations",
  "detections",
  "boxes",
  "findings",
  "measurements",
  "results",
  "items",
  "images"
] as const;

const PHOTO_NAME_KEYS = [
  "photo_key",
  "photo_filename",
  "image_name",
  "image_id",
  "filename",
  "file_name",
  "image"
] as const;

const DEFECT_TYPE_KEYS = [
  "defect_type",
  "class_name",
  "type",
  "label",
  "category",
  "name"
] as const;

const DEFECT_TYPE_ALIASES: Record<string, string> = {
  crack: "crack",
  cracks: "crack",
  liefeng: "crack",
  裂缝: "crack",
  spalling: "spalling",
  spall: "spalling",
  boluo: "spalling",
  剥落: "spalling",
  hollow: "hollow",
  tac: "hollow",
  空鼓: "hollow"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function positiveNumber(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizedDefectType(value: string) {
  const compact = value.trim().toLocaleLowerCase().replace(/[\s_.-]+/g, "");
  return DEFECT_TYPE_ALIASES[compact] ?? null;
}

function dimensionsFrom(record: Record<string, unknown>, inherited: ImportDimensions): ImportDimensions {
  return {
    width: positiveNumber(record.image_width ?? record.source_width) ?? inherited.width,
    height: positiveNumber(record.image_height ?? record.source_height) ?? inherited.height
  };
}

function sourcePhotoName(sourceName: string) {
  const base = sourceName.split(/[\\/]/).pop() ?? sourceName;
  return base.toLocaleLowerCase().endsWith(".json") ? base.slice(0, -5) : base;
}

function normalizedPhotoName(value: string) {
  let name = value.trim().split(/[\\/]/).pop() ?? value.trim();
  name = name.split(/[?#]/, 1)[0];
  try {
    name = decodeURIComponent(name);
  } catch {
    // Keep the original filename if it is not URI encoded.
  }
  if (name.toLocaleLowerCase().endsWith(".json")) name = name.slice(0, -5);
  return name.toLocaleLowerCase();
}

function looksLikePhotoName(value: string) {
  return /\.(?:jpe?g|png|webp|tiff?|bmp)(?:\.json)?$/i.test(value.trim());
}

function bboxRecord(value: Record<string, unknown>) {
  const nested = value.bbox ?? value.box ?? value.bounding_box ?? value.boundingBox;
  if (isRecord(nested)) return nested;
  if (Array.isArray(nested)) return nested;
  return value;
}

function hasBBox(value: Record<string, unknown>) {
  const bbox = bboxRecord(value);
  if (Array.isArray(bbox)) return bbox.length >= 4;
  const x = finiteNumber(bbox.x ?? bbox.left ?? bbox.xmin ?? bbox.x_min ?? bbox.x1 ?? bbox.x_center ?? bbox.cx);
  const y = finiteNumber(bbox.y ?? bbox.top ?? bbox.ymin ?? bbox.y_min ?? bbox.y1 ?? bbox.y_center ?? bbox.cy);
  const maxX = finiteNumber(bbox.xmax ?? bbox.x_max ?? bbox.x2 ?? bbox.right);
  const maxY = finiteNumber(bbox.ymax ?? bbox.y_max ?? bbox.y2 ?? bbox.bottom);
  const width = positiveNumber(bbox.width ?? bbox.w) ?? (x !== null && maxX !== null && maxX > x ? maxX - x : null);
  const height = positiveNumber(bbox.height ?? bbox.h) ?? (y !== null && maxY !== null && maxY > y ? maxY - y : null);
  return (
    width !== null
    && height !== null
    && x !== null
    && y !== null
  );
}

function isCountOnlyJson(value: unknown) {
  if (!isRecord(value)) return false;
  const entries = Object.values(value);
  return entries.length > 0 && entries.every((item) => finiteNumber(item) !== null);
}

function collectRawGroups(
  value: unknown,
  inheritedPhotoName: string,
  inheritedDimensions: ImportDimensions,
  groups: Map<string, RawPhotoGroup>,
  depth = 0
): boolean {
  if (depth > 8) return false;

  if (Array.isArray(value)) {
    if (!value.length && inheritedPhotoName) {
      const key = normalizedPhotoName(inheritedPhotoName);
      if (!groups.has(key)) groups.set(key, { photoName: inheritedPhotoName, annotations: [] });
      return true;
    }
    let found = false;
    for (const item of value) {
      found = collectRawGroups(item, inheritedPhotoName, inheritedDimensions, groups, depth + 1) || found;
    }
    return found;
  }

  if (!isRecord(value)) return false;
  const dimensions = dimensionsFrom(value, inheritedDimensions);
  const explicitPhotoName = firstString(value, PHOTO_NAME_KEYS) ?? inheritedPhotoName;

  if (hasBBox(value)) {
    if (!explicitPhotoName) return false;
    const key = normalizedPhotoName(explicitPhotoName);
    const group = groups.get(key) ?? { photoName: explicitPhotoName, annotations: [] };
    group.annotations.push({ value, dimensions });
    groups.set(key, group);
    return true;
  }

  for (const key of COLLECTION_KEYS) {
    if (!(key in value)) continue;
    const collection = value[key];
    if (!Array.isArray(collection) && !isRecord(collection)) continue;
    return collectRawGroups(collection, explicitPhotoName, dimensions, groups, depth + 1);
  }

  let found = false;
  for (const [key, nested] of Object.entries(value)) {
    if (!looksLikePhotoName(key) || (!Array.isArray(nested) && !isRecord(nested))) continue;
    found = collectRawGroups(nested, key, dimensions, groups, depth + 1) || found;
  }
  return found;
}

function matchPhoto(photoName: string, photos: AnnotationImportPhoto[]) {
  const normalized = normalizedPhotoName(photoName);
  return photos.find((photo) => normalizedPhotoName(photo.filename) === normalized)
    ?? photos.find((photo) => photo.key === photoName);
}

function parseDefectType(value: Record<string, unknown>, index: number, filename: string) {
  const rawType = firstString(value, DEFECT_TYPE_KEYS);
  const defectType = rawType ? normalizedDefectType(rawType) : null;
  if (!defectType) {
    throw new Error(`${filename} 的第 ${index + 1} 个标注缺少可识别类别（支持 crack/lie_feng、spalling/bo_luo、hollow/T.A.C.）。`);
  }
  return defectType;
}

function rawBBox(value: Record<string, unknown>) {
  const candidate = bboxRecord(value);
  if (Array.isArray(candidate)) {
    return {
      x: finiteNumber(candidate[0]),
      y: finiteNumber(candidate[1]),
      width: positiveNumber(candidate[2]),
      height: positiveNumber(candidate[3]),
      center: false,
      normalized: false
    };
  }

  const width = positiveNumber(candidate.width ?? candidate.w);
  const height = positiveNumber(candidate.height ?? candidate.h);
  const centerX = finiteNumber(candidate.x_center ?? candidate.cx);
  const centerY = finiteNumber(candidate.y_center ?? candidate.cy);
  if (centerX !== null && centerY !== null) {
    return {
      x: centerX,
      y: centerY,
      width,
      height,
      center: true,
      normalized: [centerX, centerY, width, height].every((item) => item !== null && item >= 0 && item <= 1)
    };
  }

  const x = finiteNumber(candidate.x ?? candidate.left ?? candidate.xmin ?? candidate.x_min ?? candidate.x1);
  const y = finiteNumber(candidate.y ?? candidate.top ?? candidate.ymin ?? candidate.y_min ?? candidate.y1);
  const maxX = finiteNumber(candidate.xmax ?? candidate.x_max ?? candidate.x2 ?? candidate.right);
  const maxY = finiteNumber(candidate.ymax ?? candidate.y_max ?? candidate.y2 ?? candidate.bottom);
  const resolvedWidth = width ?? (x !== null && maxX !== null ? maxX - x : null);
  const resolvedHeight = height ?? (y !== null && maxY !== null ? maxY - y : null);
  const explicitlyNormalized = candidate.normalized === true || candidate.coordinate_type === "normalized";
  const implicitlyNormalized = [x, y, resolvedWidth, resolvedHeight]
    .every((item) => item !== null && item >= 0 && item <= 1);
  return {
    x,
    y,
    width: resolvedWidth !== null && resolvedWidth > 0 ? resolvedWidth : null,
    height: resolvedHeight !== null && resolvedHeight > 0 ? resolvedHeight : null,
    center: false,
    normalized: explicitlyNormalized || implicitlyNormalized
  };
}

function parseBBox(
  value: Record<string, unknown>,
  dimensions: ImportDimensions,
  photo: AnnotationImportPhoto,
  index: number
) {
  const bbox = rawBBox(value);
  if (bbox.x === null || bbox.y === null || bbox.width === null || bbox.height === null) {
    throw new Error(`${photo.filename} 的第 ${index + 1} 个标注框坐标不完整。`);
  }

  const imageWidth = dimensions.width ?? photo.imageWidth;
  const imageHeight = dimensions.height ?? photo.imageHeight;
  if (bbox.normalized && (!imageWidth || !imageHeight)) {
    throw new Error(`${photo.filename} 使用了归一化坐标，但检测结果中缺少照片宽高。请在 JSON 中提供 image_width 和 image_height。`);
  }

  const width = bbox.normalized ? bbox.width * (imageWidth ?? 1) : bbox.width;
  const height = bbox.normalized ? bbox.height * (imageHeight ?? 1) : bbox.height;
  let x = bbox.normalized ? bbox.x * (imageWidth ?? 1) : bbox.x;
  let y = bbox.normalized ? bbox.y * (imageHeight ?? 1) : bbox.y;
  if (bbox.center) {
    x -= width / 2;
    y -= height / 2;
  }

  const maxWidth = imageWidth ?? Number.POSITIVE_INFINITY;
  const maxHeight = imageHeight ?? Number.POSITIVE_INFINITY;
  const clampedX = Math.max(0, Math.min(x, Math.max(0, maxWidth - 4)));
  const clampedY = Math.max(0, Math.min(y, Math.max(0, maxHeight - 4)));
  return {
    x: Math.round(clampedX * 100) / 100,
    y: Math.round(clampedY * 100) / 100,
    width: Math.round(Math.max(4, Math.min(width, maxWidth - clampedX)) * 100) / 100,
    height: Math.round(Math.max(4, Math.min(height, maxHeight - clampedY)) * 100) / 100
  };
}

function boundedString(value: unknown) {
  return typeof value === "string" && value.trim() && value.trim().length <= 128
    ? value.trim()
    : null;
}

function parseAnnotation(raw: RawAnnotation, photo: AnnotationImportPhoto, index: number): ManagedAnnotation {
  const value = raw.value;
  const confidence = finiteNumber(value.confidence ?? value.score ?? value.probability);
  return {
    id: boundedString(value.id ?? value.detection_id ?? value.measurement_id) ?? createClientId("imported-annotation"),
    source_annotation_id: boundedString(value.source_annotation_id),
    defect_type: parseDefectType(value, index, photo.filename),
    bbox: parseBBox(value, raw.dimensions, photo, index),
    confidence: confidence === null ? null : Math.max(0, Math.min(1, confidence))
  };
}

export function parseReviewAnnotationJson(
  sourceName: string,
  text: string,
  photos: AnnotationImportPhoto[]
): AnnotationImportParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${sourceName} 不是有效的 JSON 文件。`);
  }

  const groups = new Map<string, RawPhotoGroup>();
  const found = collectRawGroups(
    data,
    sourcePhotoName(sourceName),
    { width: null, height: null },
    groups
  );
  if (!found || !groups.size) {
    if (isCountOnlyJson(data)) {
      throw new Error(`${sourceName} 仅包含类别数量，不含标注框坐标，无法导入。`);
    }
    throw new Error(`${sourceName} 中未找到 annotations、detections、measurements 或 bbox 标注框。`);
  }

  const matches: AnnotationImportMatch[] = [];
  const unmatchedPhotoNames: string[] = [];
  for (const group of groups.values()) {
    const photo = matchPhoto(group.photoName, photos);
    if (!photo) {
      unmatchedPhotoNames.push(group.photoName);
      continue;
    }
    matches.push({
      photoKey: photo.key,
      filename: photo.filename,
      annotations: group.annotations.map((annotation, index) => parseAnnotation(annotation, photo, index))
    });
  }

  return { matches, unmatchedPhotoNames };
}
