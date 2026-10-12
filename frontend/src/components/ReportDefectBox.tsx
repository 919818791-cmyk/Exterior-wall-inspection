import type { CSSProperties } from "react";

import type { ReportDefectSnapshot } from "@/types/reports";
import { formatDefectNumber, trialDefectDisplayFromType } from "@/utils/trialDefectDisplay";

export function ReportDefectBox({
  defect,
  imageWidth,
  imageHeight,
  fallbackIndex = 0
}: {
  defect: ReportDefectSnapshot;
  imageWidth?: number | string | null;
  imageHeight?: number | string | null;
  fallbackIndex?: number;
}) {
  const defectDisplay = trialDefectDisplayFromType(defect.defect_type);
  const boxStyle = reportDefectBoxStyle(defect, imageWidth, imageHeight);
  if (!boxStyle) return null;

  return (
    <span
      className={`trial-defect-box ${defectDisplay.boxClassName}`}
      style={boxStyle}
    >
      <span className="trial-defect-label">
        {defect.defect_no || formatDefectNumber(defect.defect_type, fallbackIndex + 1)}
      </span>
    </span>
  );
}

function reportDefectBoxStyle(
  defect: ReportDefectSnapshot,
  fallbackImageWidth?: number | string | null,
  fallbackImageHeight?: number | string | null
): CSSProperties | undefined {
  const bbox = defect.bbox_json;
  const x = finiteNumber(bbox?.x);
  const y = finiteNumber(bbox?.y);
  const width = finiteNumber(bbox?.width);
  const height = finiteNumber(bbox?.height);
  const imageWidth = finiteNumber(defect.raw_result_json?.finding?.image_width)
    ?? finiteNumber(fallbackImageWidth);
  const imageHeight = finiteNumber(defect.raw_result_json?.finding?.image_height)
    ?? finiteNumber(fallbackImageHeight);

  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
    return undefined;
  }

  if (imageWidth && imageHeight) {
    return {
      left: `${(x / imageWidth) * 100}%`,
      top: `${(y / imageHeight) * 100}%`,
      width: `${(width / imageWidth) * 100}%`,
      height: `${(height / imageHeight) * 100}%`,
      right: "auto",
      bottom: "auto"
    };
  }

  if (x <= 1 && y <= 1 && width <= 1 && height <= 1) {
    return {
      left: `${x * 100}%`,
      top: `${y * 100}%`,
      width: `${width * 100}%`,
      height: `${height * 100}%`,
      right: "auto",
      bottom: "auto"
    };
  }

  return undefined;
}

function finiteNumber(value: number | string | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
