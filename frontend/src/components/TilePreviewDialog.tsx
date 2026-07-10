import { X } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import type { ModelOutputDetection } from "@/types/reports";

export const TRIAL_TILE_WIDTH = 1280;
export const TRIAL_TILE_HEIGHT = 960;
export const TRIAL_TILE_OVERLAP_RATIO = 0.25;

export interface TilePreviewSource {
  filename: string;
  imageUrl: string;
  imageWidth?: number | string | null;
  imageHeight?: number | string | null;
  tileWidth?: number | string | null;
  tileHeight?: number | string | null;
  tileOverlapRatio?: number | string | null;
  detections?: ModelOutputDetection[];
}

interface TilePreviewDialogProps {
  source: TilePreviewSource;
  onClose: () => void;
}

interface ImageDimensions {
  width: number;
  height: number;
}

export function TilePreviewDialog({ source, onClose }: TilePreviewDialogProps) {
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(() => normalizedDimensions(source));
  const [loadFailed, setLoadFailed] = useState(false);
  const tileWidth = positiveNumber(source.tileWidth) ?? TRIAL_TILE_WIDTH;
  const tileHeight = positiveNumber(source.tileHeight) ?? TRIAL_TILE_HEIGHT;
  const overlapRatio = overlapNumber(source.tileOverlapRatio) ?? TRIAL_TILE_OVERLAP_RATIO;

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    setDimensions(normalizedDimensions(source));
    setLoadFailed(false);
  }, [source]);

  const tiles = useMemo(() => {
    if (!dimensions) return [];
    const xStarts = tileStarts(dimensions.width, tileWidth, overlapRatio);
    const yStarts = tileStarts(dimensions.height, tileHeight, overlapRatio);
    return yStarts.flatMap((y, row) => xStarts.map((x, column) => ({
      index: row * xStarts.length + column,
      x,
      y,
      width: Math.min(tileWidth, dimensions.width - x),
      height: Math.min(tileHeight, dimensions.height - y)
    })));
  }, [dimensions, overlapRatio, tileHeight, tileWidth]);

  return (
    <div
      className="trial-tile-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-tile-dialog-title"
      onClick={onClose}
    >
      <section className="trial-tile-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="trial-tile-dialog-header">
          <div>
            <h2 id="trial-tile-dialog-title">照片 TILE</h2>
            <p>{source.filename} · {tileWidth} × {tileHeight}px · {Math.round(overlapRatio * 100)}% 重叠 · 共 {tiles.length || "-"} 片</p>
          </div>
          <button type="button" aria-label="关闭 TILE 预览" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="trial-tile-dialog-body">
          {!dimensions && !loadFailed ? <p className="trial-tile-dialog-status">正在读取照片尺寸…</p> : null}
          {loadFailed ? <p className="trial-tile-dialog-status is-error">照片加载失败，暂时无法查看 TILE。</p> : null}
          {dimensions && !loadFailed ? (
            <div className="trial-tile-grid">
              {tiles.map((tile) => {
                const imageStyle = {
                  width: `${(dimensions.width / tileWidth) * 100}%`,
                  left: `${(-tile.x / tileWidth) * 100}%`,
                  top: `${(-tile.y / tileHeight) * 100}%`
                } satisfies CSSProperties;
                const isPadded = tile.width < tileWidth || tile.height < tileHeight;
                const tileDetections = (source.detections ?? [])
                  .map((detection) => tileDetection(detection, tile, tileWidth, tileHeight))
                  .filter((detection): detection is TileDetection => detection !== null);
                return (
                  <figure key={`${tile.x}-${tile.y}`} className="trial-tile-card">
                    <div className="trial-tile-image-frame">
                      <img alt="" aria-hidden="true" src={source.imageUrl} style={imageStyle} />
                      {tileDetections.map(({ detection, style }, detectionIndex) => (
                        <span
                          key={detection.detection_id ?? detection.id ?? `${detection.type}-${detectionIndex}`}
                          className={`trial-tile-defect-box is-${detection.type === "crack" || detection.model === "裂缝" ? "crack" : "spalling"}`}
                          style={style}
                        >
                          <span>{tileDetectionLabel(detection)}</span>
                        </span>
                      ))}
                    </div>
                    <figcaption>
                      <strong>TILE {String(tile.index + 1).padStart(2, "0")}</strong>
                      <span>起点 ({tile.x}, {tile.y}) · 有效区域 {tile.width} × {tile.height}px{isPadded ? " · 白色补齐" : ""}</span>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          ) : null}
          <img
            className="trial-tile-source-probe"
            alt=""
            aria-hidden="true"
            src={source.imageUrl}
            onLoad={(event) => {
              const image = event.currentTarget;
              if (!normalizedDimensions(source)) {
                setDimensions({ width: image.naturalWidth, height: image.naturalHeight });
              }
              setLoadFailed(false);
            }}
            onError={() => setLoadFailed(true)}
          />
        </div>
      </section>
    </div>
  );
}

interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TileDetection {
  detection: ModelOutputDetection;
  style: CSSProperties;
}

function tileDetection(
  detection: ModelOutputDetection,
  tile: TileRect,
  tileWidth: number,
  tileHeight: number
): TileDetection | null {
  const bbox = detection.bbox;
  const x = finiteNumber(bbox?.x);
  const y = finiteNumber(bbox?.y);
  const width = finiteNumber(bbox?.width);
  const height = finiteNumber(bbox?.height);
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) return null;

  const left = Math.max(x, tile.x);
  const top = Math.max(y, tile.y);
  const right = Math.min(x + width, tile.x + tile.width);
  const bottom = Math.min(y + height, tile.y + tile.height);
  if (right <= left || bottom <= top) return null;

  return {
    detection,
    style: {
      left: `${((left - tile.x) / tileWidth) * 100}%`,
      top: `${((top - tile.y) / tileHeight) * 100}%`,
      width: `${((right - left) / tileWidth) * 100}%`,
      height: `${((bottom - top) / tileHeight) * 100}%`
    }
  };
}

function tileDetectionLabel(detection: ModelOutputDetection) {
  const name = detection.type_name
    ?? (detection.type === "crack" || detection.model === "裂缝" ? "裂缝" : "剥落");
  const confidence = finiteNumber(detection.confidence);
  return confidence === null ? name : `${name} ${Math.round(confidence * 100)}%`;
}

function finiteNumber(value: number | string | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizedDimensions(source: TilePreviewSource): ImageDimensions | null {
  const width = positiveNumber(source.imageWidth);
  const height = positiveNumber(source.imageHeight);
  return width && height ? { width, height } : null;
}

function positiveNumber(value: number | string | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function overlapNumber(value: number | string | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric < 1 ? numeric : null;
}

function tileStarts(length: number, tileSize: number, overlapRatio: number) {
  if (length <= tileSize) return [0];
  const step = Math.max(1, Math.round(tileSize * (1 - overlapRatio)));
  const starts: number[] = [];
  let start = 0;
  while (true) {
    starts.push(start);
    if (start + tileSize >= length) return starts;
    start += step;
  }
}
