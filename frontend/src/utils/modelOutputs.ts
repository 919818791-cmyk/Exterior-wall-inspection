import type { ModelOutputDetection, ModelOutputPhoto } from "@/types/reports";

const DEFECT_LABELS: Record<string, string> = {
  crack: "裂缝",
  missing: "剥落",
  spalling: "剥落",
  moisture: "潮湿",
  leakage: "潮湿",
  corrosion: "锈蚀",
  bulge: "空鼓"
};

export function hasModelOutputs(outputs: ModelOutputPhoto[] | null | undefined) {
  return Boolean(outputs?.some((output) => output.detections?.length));
}

export function formatModelOutputs(outputs: ModelOutputPhoto[] | null | undefined) {
  if (!hasModelOutputs(outputs)) return "暂无模型原始输出。";

  return (outputs ?? []).map((output, photoIndex) => {
    const detections = [...(output.detections ?? [])].sort((left, right) => (
      confidenceNumber(right.confidence) - confidenceNumber(left.confidence)
    ));
    const lines = [
      `照片 ${photoIndex + 1}: ${output.filename || output.photo_id || "未命名照片"}`
    ];
    if (output.image_width || output.image_height) {
      lines.push(`图像尺寸: ${output.image_width ?? "-"} x ${output.image_height ?? "-"}`);
    }
    if (output.tile_width && output.tile_height) {
      lines.push(`切片尺寸: ${output.tile_width} x ${output.tile_height}`);
    }
    if (output.tile_overlap_ratio !== null && output.tile_overlap_ratio !== undefined) {
      lines.push(`切片重叠: ${Math.round(Number(output.tile_overlap_ratio) * 100)}%`);
    }
    if (output.deduplication_method === "nms") {
      lines.push(`重复框处理: NMS（IoU ${output.nms_iou_threshold ?? "-"}）`);
    }
    lines.push(`候选框数量: ${detections.length}`);

    if (!detections.length) {
      lines.push("  未返回候选框");
      return lines.join("\n");
    }

    detections.forEach((detection, index) => {
      const label = detectionLabel(detection);
      const confidence = confidenceText(detection.confidence);
      const status = detection.visible === false
        ? "低于展示阈值"
        : detection.visible === true ? "已进入结果" : "候选";
      lines.push(`  ${index + 1}. ${label} · 置信度 ${confidence} · ${status}`);
      lines.push(`     bbox: ${bboxText(detection.bbox)}`);
      if (detection.description) lines.push(`     说明: ${detection.description}`);
    });
    return lines.join("\n");
  }).join("\n\n");
}

function detectionLabel(detection: ModelOutputDetection) {
  const type = detection.type || "";
  return detection.model || detection.type_name || DEFECT_LABELS[type] || type || "未知类别";
}

function confidenceNumber(value: number | string | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : -1;
}

function confidenceText(value: number | string | null | undefined) {
  const numeric = confidenceNumber(value);
  return numeric >= 0 ? `${Math.round(numeric * 1000) / 10}%` : "-";
}

function bboxText(bbox: ModelOutputDetection["bbox"]) {
  if (!bbox) return "-";
  return `x ${bbox.x ?? "-"}, y ${bbox.y ?? "-"}, w ${bbox.width ?? "-"}, h ${bbox.height ?? "-"}`;
}
