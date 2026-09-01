import type {
  ModelOutputDetection,
  ModelOutputPhoto,
  ModelTokenUsage
} from "@/types/reports";

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
  return Boolean(outputs?.length);
}

export function formatModelOutputs(outputs: ModelOutputPhoto[] | null | undefined) {
  if (!hasModelOutputs(outputs)) return "暂无模型原始输出。";

  const normalizedOutputs = outputs ?? [];
  const sections = [formatTaskSummary(normalizedOutputs)];
  sections.push(...normalizedOutputs.map((output, photoIndex) => {
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
    lines.push(`Token 消耗: ${tokenUsageText(output.token_usage)}`);
    lines.push(`Token 统计覆盖: ${tokenCoverageText(output.token_usage, numberValue(output.tile_count))}`);
    if (output.deduplication_method === "cross_tile_union+nms") {
      lines.push(
        `重复框处理: 相邻 TILE 并集融合（IoS ${output.cross_tile_merge_ios_threshold ?? "-"}）`
        + ` + NMS（IoU ${output.nms_iou_threshold ?? "-"}）`
      );
      if (
        output.pre_merge_detection_count !== null
        && output.pre_merge_detection_count !== undefined
        && output.post_merge_detection_count !== null
        && output.post_merge_detection_count !== undefined
      ) {
        lines.push(
          `跨 TILE 融合: ${output.pre_merge_detection_count} → ${output.post_merge_detection_count}`
        );
      }
    } else if (output.deduplication_method === "nms") {
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
  }));
  return sections.join("\n\n");
}

export function hasTileTokenUsages(outputs: ModelOutputPhoto[] | null | undefined) {
  return Boolean(outputs?.some((output) => output.tile_token_usages?.length));
}

export function formatTileTokenUsages(outputs: ModelOutputPhoto[] | null | undefined) {
  if (!hasTileTokenUsages(outputs)) return "暂无每个 tile 的 Token 明细。";

  return (outputs ?? [])
    .map((output, photoIndex) => ({ output, photoIndex }))
    .filter(({ output }) => output.tile_token_usages?.length)
    .map(({ output, photoIndex }) => {
      const lines = [`照片 ${photoIndex + 1}: ${output.filename || output.photo_id || "未命名照片"}`];
      for (const [index, tile] of (output.tile_token_usages ?? []).entries()) {
        const tileIndex = tile.tile_index ?? index + 1;
        const region = [tile.x, tile.y, tile.valid_width, tile.valid_height]
          .every((value) => value !== null && value !== undefined)
          ? ` · 区域 (${tile.x}, ${tile.y}) ${tile.valid_width} x ${tile.valid_height}`
          : "";
        lines.push(`  Tile ${tileIndex}${region} · ${tokenUsageText(tile.token_usage)}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

function formatTaskSummary(outputs: ModelOutputPhoto[]) {
  const taskUsage = aggregateTokenUsages(outputs.map((output) => output.token_usage));
  const requestCount = outputs.reduce(
    (total, output) => total + (numberValue(output.token_usage?.request_count) ?? numberValue(output.tile_count) ?? 0),
    0
  );
  const lines = [
    "任务汇总",
  ];
  const usedModels = Array.from(new Set(
    outputs
      .map((output) => output.upstream_model || output.model_version)
      .filter((model): model is string => Boolean(model?.trim()))
      .map((model) => model.trim())
  ));
  const taskDuration = outputs
    .map((output) => numberValue(output.task_duration_seconds))
    .find((value): value is number => value !== null);
  lines.push(`使用模型: ${usedModels.length ? usedModels.join("、") : "未记录"}`);
  lines.push(`任务总耗时: ${taskDuration === undefined ? "未记录" : durationText(taskDuration)}`);
  lines.push(
    `Token 消耗: ${tokenUsageText(taskUsage)}`,
    `Token 统计覆盖: ${tokenCoverageText(taskUsage, requestCount)}`
  );
  return lines.join("\n");
}

function durationText(seconds: number) {
  if (seconds < 60) return `${seconds.toFixed(2)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds - minutes * 60;
  return `${minutes} 分 ${remainingSeconds.toFixed(2)} 秒`;
}

function aggregateTokenUsages(usages: Array<ModelTokenUsage | null | undefined>): ModelTokenUsage | null {
  const available = usages.filter((usage): usage is ModelTokenUsage => Boolean(usage));
  if (!available.length) return null;
  return {
    request_count: sumTokenField(available, "request_count"),
    reported_request_count: sumTokenField(available, "reported_request_count"),
    prompt_tokens: sumTokenField(available, "prompt_tokens"),
    completion_tokens: sumTokenField(available, "completion_tokens"),
    total_tokens: sumTokenField(available, "total_tokens"),
    prompt_tokens_details: {
      image_tokens: sumNestedTokenField(available, "prompt_tokens_details", "image_tokens"),
      text_tokens: sumNestedTokenField(available, "prompt_tokens_details", "text_tokens"),
      cached_tokens: sumNestedTokenField(available, "prompt_tokens_details", "cached_tokens")
    }
  };
}

function sumTokenField(usages: ModelTokenUsage[], field: keyof ModelTokenUsage) {
  const values = usages
    .map((usage) => numberValue(usage[field]))
    .filter((value): value is number => value !== null);
  return values.length ? values.reduce((total, value) => total + value, 0) : undefined;
}

function sumNestedTokenField(
  usages: ModelTokenUsage[],
  group: "prompt_tokens_details" | "completion_tokens_details",
  field: "image_tokens" | "text_tokens" | "cached_tokens" | "reasoning_tokens"
) {
  const values = usages
    .map((usage) => numberValue(usage[group]?.[field]))
    .filter((value): value is number => value !== null);
  return values.length ? values.reduce((total, value) => total + value, 0) : undefined;
}

function tokenUsageText(usage: ModelTokenUsage | null | undefined) {
  if (!usage || numberValue(usage.total_tokens) === null) return "未记录 Token usage（旧结果或上游未返回）";
  const parts = [
    `总计 ${tokenNumber(usage.total_tokens)}`,
    `输入 ${tokenNumber(usage.prompt_tokens)}`,
    `输出 ${tokenNumber(usage.completion_tokens)}`
  ];
  const imageTokens = numberValue(usage.prompt_tokens_details?.image_tokens);
  const textTokens = numberValue(usage.prompt_tokens_details?.text_tokens);
  const cachedTokens = numberValue(usage.prompt_tokens_details?.cached_tokens);
  if (imageTokens !== null) parts.push(`图像输入 ${tokenNumber(imageTokens)}`);
  if (textTokens !== null) parts.push(`文本输入 ${tokenNumber(textTokens)}`);
  if (cachedTokens !== null) parts.push(`缓存命中 ${tokenNumber(cachedTokens)}`);
  return parts.join(" · ");
}

function tokenCoverageText(usage: ModelTokenUsage | null | undefined, fallbackRequestCount: number | null) {
  const requestCount = fallbackRequestCount ?? numberValue(usage?.request_count);
  const reportedCount = numberValue(usage?.reported_request_count) ?? 0;
  return requestCount !== null ? `${reportedCount}/${requestCount} 个 API 请求` : "未知";
}

function tokenNumber(value: unknown) {
  const numeric = numberValue(value);
  return numeric === null ? "-" : numeric.toLocaleString("zh-CN");
}

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
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
