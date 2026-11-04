import { CanvasTexture, MathUtils, Matrix4, SRGBColorSpace, Vector3 } from "three";

import type { Photo } from "@/types/projects";
import type { ReviewProjectResults } from "@/types/review";
import type { ReportDefectSnapshot, ReportDetail } from "@/types/reports";
import { formatDefectNumber, trialDefectDisplayFromType } from "@/utils/trialDefectDisplay";

export const EARTH_RADIUS_METERS = 6_378_137;
const DEFAULT_HORIZONTAL_FOV_DEGREES = 70;

export interface GeographicModelOrigin {
  elevation: number;
  latitude: number;
  longitude: number;
}

export interface ProjectablePhoto {
  id: string;
  original_filename: string;
  image_width: number | null;
  image_height: number | null;
  longitude: number | null;
  latitude: number | null;
  absolute_altitude: number | null;
  relative_altitude: number | null;
  gimbal_yaw_degree: number | null;
  gimbal_pitch_degree: number | null;
  gimbal_roll_degree: number | null;
  calibrated_focal_length: number | null;
  preview_url: string | null;
  thumbnail_url: string | null;
}

interface MetashapeCameraCalibration {
  b1: number;
  b2: number;
  k1: number;
  k2: number;
  k3: number;
  k4: number;
  cx_px: number;
  cy_px: number;
  f_px: number;
  height_px: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  width_px: number;
}

export interface MetashapeProjectionCamera {
  calibration: MetashapeCameraCalibration;
  cameraToGlbYUp: [
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
    number, number, number, number
  ];
  label: string;
  photoFilename: string | null;
}

export interface MetashapeProjectionPackage {
  cameras: MetashapeProjectionCamera[];
  origin: GeographicModelOrigin;
}

export type MetashapeCameraIndex = Map<string, MetashapeProjectionCamera | null>;

export interface DefectTag {
  count: number;
  defects: ReportDefectSnapshot[];
  defectType: string;
  id: string;
  imageUrl: string;
  label: string;
  normalizedImagePoints: Array<{ x: number; y: number }>;
  photo: ProjectablePhoto;
}

interface NumericBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function numericBBox(defect: ReportDefectSnapshot): NumericBBox | null {
  const x = Number(defect.bbox_json?.x);
  const y = Number(defect.bbox_json?.y);
  const width = Number(defect.bbox_json?.width);
  const height = Number(defect.bbox_json?.height);
  if (
    !Number.isFinite(x)
    || !Number.isFinite(y)
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) return null;
  return { x, y, width, height };
}

function normalizedBBox(bbox: NumericBBox, photo: ProjectablePhoto) {
  const normalized = (
    bbox.x <= 1
    && bbox.y <= 1
    && bbox.width <= 1
    && bbox.height <= 1
  );
  const scaleX = normalized ? 1 : Math.max(photo.image_width ?? 1, 1);
  const scaleY = normalized ? 1 : Math.max(photo.image_height ?? 1, 1);
  const x = MathUtils.clamp(bbox.x / scaleX, 0, 1);
  const y = MathUtils.clamp(bbox.y / scaleY, 0, 1);
  const right = MathUtils.clamp((bbox.x + bbox.width) / scaleX, x, 1);
  const bottom = MathUtils.clamp((bbox.y + bbox.height) / scaleY, y, 1);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y
  };
}

export function buildDefectTags(results: ReviewProjectResults | undefined): DefectTag[] {
  if (!results) return [];

  const reviewedByAiResult = new Map(
    results.review_results
      .filter((result) => result.ai_result_id)
      .map((result) => [result.ai_result_id as string, result])
  );
  const resolved = results.ai_results.flatMap((result) => {
    const reviewed = reviewedByAiResult.get(result.id);
    if (reviewed?.status === "deleted") return [];
    return [reviewed ?? result];
  });
  resolved.push(...results.review_results.filter((result) => (
    !result.ai_result_id && result.status !== "deleted"
  )));

  const defects = numberDefectsForDisplay(resolved.map((result): ReportDefectSnapshot => ({
    id: result.id,
    photo_id: result.photo_id,
    defect_type: result.defect_type,
    bbox_json: result.bbox_json
  })));
  return groupDefectTags(defects, results.photos);
}

export function buildReviewedReportDefectTags(
  report: ReportDetail | undefined,
  photos: Photo[] | undefined
): DefectTag[] {
  if (!report || !photos) return [];
  return groupDefectTags(
    numberDefectsForDisplay(report.defects.filter((defect) => defect.status !== "deleted")),
    photos
  );
}

function numberDefectsForDisplay(defects: ReportDefectSnapshot[]) {
  const counters = new Map<string, number>();
  return defects.map((defect) => {
    const label = trialDefectDisplayFromType(defect.defect_type).label;
    const sequence = (counters.get(label) ?? 0) + 1;
    counters.set(label, sequence);
    return {
      ...defect,
      defect_no: defect.defect_no || formatDefectNumber(defect.defect_type, sequence)
    };
  });
}

function groupDefectTags(
  defects: ReportDefectSnapshot[],
  projectPhotos: ProjectablePhoto[]
): DefectTag[] {
  const photos = new Map(projectPhotos.map((photo) => [photo.id, photo]));
  const grouped = new Map<string, {
    defects: ReportDefectSnapshot[];
    defectType: string;
    photo: ProjectablePhoto;
    points: Array<{ x: number; y: number }>;
  }>();
  defects.forEach((defect) => {
    const photo = defect.photo_id ? photos.get(defect.photo_id) : undefined;
    const defectType = defect.defect_type?.trim();
    const bbox = numericBBox(defect);
    if (!photo || !defectType || !bbox) return;
    const key = `${photo.id}:${defectType}`;
    const current = grouped.get(key) ?? {
      defects: [],
      defectType,
      photo,
      points: []
    };
    const box = normalizedBBox(bbox, photo);
    current.defects.push(defect);
    current.points.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    grouped.set(key, current);
  });

  return Array.from(grouped, ([id, group]) => {
    const imageUrl = group.photo.preview_url ?? group.photo.thumbnail_url ?? "";
    const center = group.points.reduce(
      (value, point) => ({ x: value.x + point.x, y: value.y + point.y }),
      { x: 0, y: 0 }
    );
    center.x /= Math.max(group.points.length, 1);
    center.y /= Math.max(group.points.length, 1);
    const nearbyPoints = [...group.points].sort((left, right) => (
      Math.hypot(left.x - center.x, left.y - center.y)
      - Math.hypot(right.x - center.x, right.y - center.y)
    ));
    return {
      count: group.points.length,
      defects: group.defects,
      defectType: group.defectType,
      id,
      imageUrl,
      label: trialDefectDisplayFromType(group.defectType).label,
      normalizedImagePoints: [center, ...nearbyPoints.slice(0, 5)],
      photo: group.photo
    };
  }).filter((tag) => tag.imageUrl);
}

export function createTagTexture(text: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#ffffff";
  context.strokeStyle = "#245cff";
  context.lineWidth = 4;
  context.beginPath();
  context.roundRect(2, 2, 380, 92, 16);
  context.fill();
  context.stroke();
  context.fillStyle = "#245cff";
  context.font = "600 38px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 192, 49, 344);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cameraMatrix(value: unknown): MetashapeProjectionCamera["cameraToGlbYUp"] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const flattened = value.flatMap((row) => Array.isArray(row) ? row : []);
  if (flattened.length !== 16) return null;
  const numbers = flattened.map(finiteNumber);
  if (numbers.some((number) => number === null)) return null;
  return numbers as MetashapeProjectionCamera["cameraToGlbYUp"];
}

function projectionCamera(value: unknown): MetashapeProjectionCamera | null {
  const camera = objectValue(value);
  const calibration = objectValue(camera?.calibration);
  const estimated = objectValue(camera?.estimated);
  const matrix = cameraMatrix(estimated?.camera_to_glb_yup);
  const f = finiteNumber(calibration?.f_px);
  const width = finiteNumber(calibration?.width_px);
  const height = finiteNumber(calibration?.height_px);
  const b1 = finiteNumber(calibration?.b1) ?? 0;
  const cameraModel = String(calibration?.camera_model ?? "Frame");
  if (
    !camera
    || camera.aligned !== true
    || !matrix
    || f === null
    || width === null
    || height === null
    || f <= 0
    || Math.abs(f + b1) < 1e-9
    || width <= 0
    || height <= 0
    || !cameraModel.endsWith("Frame")
  ) return null;

  return {
    calibration: {
      b1,
      b2: finiteNumber(calibration?.b2) ?? 0,
      k1: finiteNumber(calibration?.k1) ?? 0,
      k2: finiteNumber(calibration?.k2) ?? 0,
      k3: finiteNumber(calibration?.k3) ?? 0,
      k4: finiteNumber(calibration?.k4) ?? 0,
      cx_px: finiteNumber(calibration?.cx_px) ?? 0,
      cy_px: finiteNumber(calibration?.cy_px) ?? 0,
      f_px: f,
      height_px: height,
      p1: finiteNumber(calibration?.p1) ?? 0,
      p2: finiteNumber(calibration?.p2) ?? 0,
      p3: finiteNumber(calibration?.p3) ?? 0,
      p4: finiteNumber(calibration?.p4) ?? 0,
      width_px: width
    },
    cameraToGlbYUp: matrix,
    label: String(camera.label ?? ""),
    photoFilename: typeof camera.photo_filename === "string" ? camera.photo_filename : null
  };
}

export function parseMetashapeProjectionPackage(assetExtras: unknown): MetashapeProjectionPackage | null {
  const extras = objectValue(assetExtras);
  const webPackage = objectValue(extras?.metashape_web_package);
  if (!webPackage || webPackage.schema !== "metashape-web-package/1.0") return null;

  const georef = objectValue(webPackage.georef);
  const localFrame = objectValue(georef?.local_frame);
  const origin = objectValue(localFrame?.origin_wgs84);
  const glb = objectValue(georef?.glb);
  const axes = objectValue(glb?.axes);
  const longitude = finiteNumber(origin?.longitude_deg);
  const latitude = finiteNumber(origin?.latitude_deg);
  const elevation = finiteNumber(origin?.ellipsoidal_height_m);
  if (
    longitude === null
    || latitude === null
    || elevation === null
    || longitude < -180
    || longitude > 180
    || latitude < -90
    || latitude > 90
    || axes?.x !== "East"
    || axes?.y !== "Up"
    || axes?.z !== "-North"
  ) return null;

  const camerasPackage = objectValue(webPackage.cameras);
  const cameras = Array.isArray(camerasPackage?.cameras)
    ? camerasPackage.cameras.map(projectionCamera).filter((camera) => camera !== null)
    : [];
  return {
    cameras,
    origin: { elevation, latitude, longitude }
  };
}

function cameraLookupKeys(value: string | null) {
  const basename = (value ?? "").replace(/\\/g, "/").split("/").pop()?.trim().toLocaleLowerCase() ?? "";
  if (!basename) return [];
  const extensionIndex = basename.lastIndexOf(".");
  const stem = extensionIndex > 0 ? basename.slice(0, extensionIndex) : basename;
  return stem === basename ? [basename] : [basename, stem];
}

export function buildMetashapeCameraIndex(cameras: MetashapeProjectionCamera[]) {
  const index: MetashapeCameraIndex = new Map();
  cameras.forEach((camera) => {
    const keys = new Set([
      ...cameraLookupKeys(camera.photoFilename),
      ...cameraLookupKeys(camera.label)
    ]);
    keys.forEach((key) => {
      index.set(key, index.has(key) ? null : camera);
    });
  });
  return index;
}

export function findMetashapeCamera(index: MetashapeCameraIndex, photoFilename: string) {
  for (const key of cameraLookupKeys(photoFilename)) {
    const camera = index.get(key);
    if (camera) return camera;
  }
  return null;
}

export function metashapeProjectionRay(
  camera: MetashapeProjectionCamera,
  point: { x: number; y: number },
  modelOffset: Vector3
) {
  const calibration = camera.calibration;
  const pixelX = point.x * calibration.width_px;
  const pixelY = point.y * calibration.height_px;
  const distortedY = (pixelY - calibration.height_px / 2 - calibration.cy_px) / calibration.f_px;
  const distortedX = (
    pixelX
    - calibration.width_px / 2
    - calibration.cx_px
    - calibration.b2 * distortedY
  ) / (calibration.f_px + calibration.b1);
  let cameraX = distortedX;
  let cameraY = distortedY;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const radius2 = cameraX * cameraX + cameraY * cameraY;
    const radius4 = radius2 * radius2;
    const radial = 1
      + calibration.k1 * radius2
      + calibration.k2 * radius4
      + calibration.k3 * radius4 * radius2
      + calibration.k4 * radius4 * radius4;
    const tangentialScale = 1 + calibration.p3 * radius2 + calibration.p4 * radius4;
    const projectedX = cameraX * radial + (
      calibration.p1 * (radius2 + 2 * cameraX * cameraX)
      + 2 * calibration.p2 * cameraX * cameraY
    ) * tangentialScale;
    const projectedY = cameraY * radial + (
      calibration.p2 * (radius2 + 2 * cameraY * cameraY)
      + 2 * calibration.p1 * cameraX * cameraY
    ) * tangentialScale;
    const correctionX = distortedX - projectedX;
    const correctionY = distortedY - projectedY;
    cameraX += correctionX;
    cameraY += correctionY;
    if (Math.hypot(correctionX, correctionY) < 1e-12) break;
  }
  if (!Number.isFinite(cameraX) || !Number.isFinite(cameraY)) {
    cameraX = distortedX;
    cameraY = distortedY;
  }
  const values = camera.cameraToGlbYUp;
  const transform = new Matrix4().set(
    values[0], values[1], values[2], values[3],
    values[4], values[5], values[6], values[7],
    values[8], values[9], values[10], values[11],
    values[12], values[13], values[14], values[15]
  );
  const origin = new Vector3(0, 0, 0).applyMatrix4(transform).add(modelOffset);
  const target = new Vector3(cameraX, cameraY, 1).applyMatrix4(transform).add(modelOffset);
  return { direction: target.sub(origin).normalize(), origin };
}

export function photoProjectionRay(
  photo: ProjectablePhoto,
  point: { x: number; y: number },
  geographicOrigin: GeographicModelOrigin,
  modelOffset: Vector3,
  yawAdjustment = 0,
  pitchAdjustment = 0
) {
  if (
    photo.longitude === null
    || photo.latitude === null
    || photo.gimbal_yaw_degree === null
  ) return null;

  const elevation = photo.absolute_altitude ?? (
    photo.relative_altitude === null
      ? null
      : geographicOrigin.elevation + photo.relative_altitude
  );
  if (elevation === null) return null;

  const metersPerDegreeLatitude = EARTH_RADIUS_METERS * MathUtils.DEG2RAD;
  const metersPerDegreeLongitude = (
    metersPerDegreeLatitude
    * Math.cos(geographicOrigin.latitude * MathUtils.DEG2RAD)
  );
  const origin = new Vector3(
    (photo.longitude - geographicOrigin.longitude) * metersPerDegreeLongitude,
    elevation - geographicOrigin.elevation,
    -(photo.latitude - geographicOrigin.latitude) * metersPerDegreeLatitude
  ).add(modelOffset);

  const yaw = MathUtils.degToRad(photo.gimbal_yaw_degree + yawAdjustment);
  const pitch = MathUtils.degToRad((photo.gimbal_pitch_degree ?? 0) + pitchAdjustment);
  const roll = MathUtils.degToRad(photo.gimbal_roll_degree ?? 0);
  const forward = new Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch)
  ).normalize();
  let right = new Vector3(Math.cos(yaw), 0, Math.sin(yaw)).normalize();
  let up = right.clone().cross(forward).normalize();
  if (roll !== 0) {
    const unrolledRight = right;
    right = unrolledRight.clone().multiplyScalar(Math.cos(roll)).addScaledVector(up, Math.sin(roll));
    up = up.multiplyScalar(Math.cos(roll)).addScaledVector(unrolledRight, -Math.sin(roll));
  }

  const width = Math.max(photo.image_width ?? 1, 1);
  const height = Math.max(photo.image_height ?? 1, 1);
  const focalLength = photo.calibrated_focal_length ?? (
    width / (2 * Math.tan(MathUtils.degToRad(DEFAULT_HORIZONTAL_FOV_DEGREES / 2)))
  );
  const direction = forward
    .addScaledVector(right, ((point.x - 0.5) * width) / focalLength)
    .addScaledVector(up, ((0.5 - point.y) * height) / focalLength)
    .normalize();
  return { direction, origin };
}
