"""Deterministic object matching and review-backed quality snapshots.

Scores are percentages at a fixed operating point, not AP/mAP. Matching first
maximizes cardinality, then total IoU; annotation IDs are never used as truth.
"""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from heapq import heappop, heappush
from math import isfinite
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.tables import (
    AiDetectionResult, AnnotationPhotoEdit, DetectionConfig, DetectionTask,
    DetectionTaskPhoto, InspectionReport, Photo, QualityBaseline, QualityEvaluation,
)

RULE_VERSION = "bbox-iou50-f1-v1"
RULE = {"version": RULE_VERSION, "iou_threshold": 0.5,
        "matching": "maximum-cardinality-then-total-iou", "score": "100 * F1"}
DEFECT_TYPES = ("crack", "spalling", "peeling", "damage", "hollow")


def iou(a: dict, b: dict) -> float:
    overlap = max(0, min(a["x"] + a["width"], b["x"] + b["width"]) - max(a["x"], b["x"])) * max(
        0, min(a["y"] + a["height"], b["y"] + b["height"]) - max(a["y"], b["y"]))
    union = a["width"] * a["height"] + b["width"] * b["height"] - overlap
    return overlap / union if union > 0 else 0.0


def validate_boxes(boxes: list[dict], width: int | None, height: int | None) -> None:
    if boxes and (not width or not height):
        raise ValueError("照片缺少原图尺寸，请补充尺寸或标记为无法评估。")
    for item in boxes:
        box = item.get("bbox") or {}
        if not all(isinstance(box.get(k), (float, int)) and isfinite(box[k]) for k in ("x", "y", "width", "height")):
            raise ValueError("标注框坐标必须为有限数值。")
        if (box["x"] < 0 or box["y"] < 0 or box["width"] <= 0 or box["height"] <= 0
                or box["x"] + box["width"] > width + 0.01
                or box["y"] + box["height"] > height + 0.01):
            raise ValueError("标注框超出原图范围，请调整后再确认。")


def match_boxes(predictions: list[dict], truth: list[dict], threshold: float = 0.5) -> list[tuple[int, int, float]]:
    # Successive shortest augmenting paths. Integer costs avoid unstable float
    # ties. Every augmentation increases cardinality regardless of IoU cost.
    n, m = len(predictions), len(truth)
    source, sink = n + m, n + m + 1
    graph: list[list[list[int]]] = [[] for _ in range(n + m + 2)]

    def edge(a, b, cost):
        forward = [b, len(graph[b]), 1, cost]
        graph[a].append(forward)
        graph[b].append([a, len(graph[a]) - 1, 0, -cost])
        return forward

    for a in range(n):
        edge(source, a, 0)
    for b in range(m):
        edge(n + b, sink, 0)
    candidates = []
    for a, pred in enumerate(predictions):
        for b, actual in enumerate(truth):
            if pred["defect_type"] != actual["defect_type"]:
                continue
            overlap = iou(pred["bbox"], actual["bbox"])
            if overlap >= threshold:
                candidates.append((a, b, overlap, edge(a, n + b, round((1 - overlap) * 1_000_000_000))))
    potential = [0] * len(graph)
    while True:
        distance = [float("inf")] * len(graph)
        previous = [None] * len(graph)
        distance[source] = 0
        queue = [(0, source)]
        while queue:
            cost, node = heappop(queue)
            if cost != distance[node]:
                continue
            for index, (target, _, capacity, weight) in enumerate(graph[node]):
                candidate = cost + weight + potential[node] - potential[target]
                if capacity and candidate < distance[target]:
                    distance[target] = candidate
                    previous[target] = (node, index)
                    heappush(queue, (candidate, target))
        if previous[sink] is None:
            break
        for index, cost in enumerate(distance):
            if isfinite(cost):
                potential[index] += cost
        node = sink
        while node != source:
            parent, index = previous[node]
            item = graph[parent][index]
            item[2] -= 1
            graph[node][item[1]][2] += 1
            node = parent
    return [(a, b, overlap) for a, b, overlap, item in candidates if item[2] == 0]


def metrics(tp=0, fp=0, fn=0, iou_sum=0.0) -> dict:
    return {"tp": tp, "fp": fp, "fn": fn, "iou_sum": iou_sum,
            "precision": 100 * tp / (tp + fp) if tp + fp else None,
            "recall": 100 * tp / (tp + fn) if tp + fn else None,
            "score": 200 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None,
            "mean_iou": iou_sum / tp if tp else None}


def aggregate(items) -> dict:
    values = list(items)
    return metrics(*(sum(item[k] for item in values) for k in ("tp", "fp", "fn", "iou_sum")))


def evaluate_photo(predictions: list[dict], truth: list[dict]) -> dict:
    matches = match_boxes(predictions, truth)
    matched_predictions = {a for a, _, _ in matches}
    matched_truth = {b for _, b, _ in matches}
    details = [{"kind": "tp", "prediction": predictions[a], "truth": truth[b], "iou": overlap}
               for a, b, overlap in matches]
    details += [{"kind": "fp", "prediction": item, "truth": None, "iou": None}
                for a, item in enumerate(predictions) if a not in matched_predictions]
    details += [{"kind": "fn", "prediction": None, "truth": item, "iou": None}
                for b, item in enumerate(truth) if b not in matched_truth]
    by_type = {}
    for category in sorted({item["defect_type"] for item in predictions + truth}):
        relevant = [d for d in details if (d["prediction"] or d["truth"])["defect_type"] == category]
        by_type[category] = metrics(sum(d["kind"] == "tp" for d in relevant),
            sum(d["kind"] == "fp" for d in relevant), sum(d["kind"] == "fn" for d in relevant),
            sum(d["iou"] or 0 for d in relevant))
    return {"metrics": metrics(len(matches), len(predictions) - len(matches), len(truth) - len(matches),
                               sum(overlap for _, _, overlap in matches)),
            "by_type": by_type, "details": details}


def build_baseline(db: Session, task: DetectionTask) -> dict:
    if task.status != "success":
        raise ValueError("仅成功完成的检测任务可以评估。")
    photos = list(db.scalars(select(Photo).join(DetectionTaskPhoto, DetectionTaskPhoto.photo_id == Photo.id)
        .where(DetectionTaskPhoto.detection_task_id == task.id).order_by(Photo.id)))
    if not photos or len(photos) != task.photo_count or any(p.deleted_at is not None for p in photos):
        raise ValueError("原始送检照片记录不完整，无法建立可信评估基线。")
    summary = task.result_summary or {}
    config = summary.get("detection_config") or {}
    selected = config.get("model_types")
    if not selected and task.detection_config_id:
        detection_config = db.get(DetectionConfig, task.detection_config_id)
        selected = detection_config.model_types if detection_config else None
    if not selected:
        raise ValueError("缺少任务检测项记录，无法确定评估范围。")
    selected = [item for item in DEFECT_TYPES if item in selected]
    if not selected:
        raise ValueError("该任务没有支持评估的检测项。")
    predictions = list(db.scalars(select(AiDetectionResult).where(AiDetectionResult.detection_task_id == task.id)
                                 .order_by(AiDetectionResult.id)))
    if summary.get("total_detections") is None or summary["total_detections"] != len(predictions):
        raise ValueError("AI 原始结果缺失或数量不一致，无法建立可信评估基线。")
    by_photo = defaultdict(list)
    valid_ids = {photo.id for photo in photos}
    for item in predictions:
        if item.photo_id not in valid_ids:
            raise ValueError("AI 原始结果包含未送检照片。")
        if item.defect_type in selected:
            by_photo[item.photo_id].append({"id": str(item.id), "defect_type": item.defect_type,
                "bbox": deepcopy(item.bbox_json), "confidence": float(item.confidence) if item.confidence is not None else None,
                "model_version": item.model_version, "strategy_key": (item.raw_result_json or {}).get("strategy_key")})
    data = []
    for photo in photos:
        boxes = by_photo[photo.id]
        unavailable_reason = None
        try:
            validate_boxes(boxes, photo.image_width, photo.image_height)
        except ValueError as exc:
            unavailable_reason = str(exc)
        data.append({"photo_key": f"photo:{photo.id}", "photo_id": str(photo.id),
            "filename": photo.original_filename, "width": photo.image_width, "height": photo.image_height,
            "storage_bucket": photo.storage_bucket, "storage_object_key": photo.storage_object_key,
            "predictions": boxes, "unavailable_reason": unavailable_reason})
    # Only immutable evaluation provenance is copied; runtime credentials are never stored here.
    provenance = {key: deepcopy(config[key]) for key in ("model_types", "facade_type", "model", "prompts", "tiling") if key in config}
    provenance["strategies"] = [{key: deepcopy(value) for key, value in strategy.items()
        if key in {"key", "strategy_key", "model_kind", "model_id", "version_id", "sha256", "model_name", "model_label", "prompt", "defect_types"}}
        for strategy in config.get("strategies", [])]
    return {"photos": data, "selected_types": selected, "provenance": provenance,
            "model_version": task.model_version}


def ensure_baseline(db: Session, task: DetectionTask) -> QualityBaseline:
    # Caller holds the report row lock; concurrent confirmation/completion is serialized.
    existing = db.scalar(select(QualityBaseline).where(QualityBaseline.detection_task_id == task.id))
    if existing is None:
        existing = QualityBaseline(detection_task_id=task.id, data_json=build_baseline(db, task))
        db.add(existing)
        db.flush()
    return existing


def evaluate_baseline(baseline: dict, edits: list[AnnotationPhotoEdit]) -> dict:
    by_key = {edit.photo_key: edit for edit in edits}
    photos, reviewed, excluded, empty_truth, empty_correct = [], 0, 0, 0, 0
    for photo in baseline["photos"]:
        edit = by_key.get(photo["photo_key"])
        state = edit.review_state if edit is not None else "pending"
        truth = [deepcopy(a) for a in edit.annotations_json if a["defect_type"] in baseline["selected_types"]] if edit else []
        output = {**deepcopy(photo), "review_state": state, "truth": truth,
                  "exclusion_reason": edit.exclusion_reason if edit else None,
                  "reviewed_by": str(edit.reviewed_by) if edit and edit.reviewed_by else None,
                  "reviewed_at": edit.reviewed_at.isoformat() if edit and edit.reviewed_at else None,
                  "metrics": None, "by_type": {}, "details": []}
        if state == "reviewed":
            if photo.get("unavailable_reason"):
                raise ValueError(photo["unavailable_reason"])
            validate_boxes(truth, photo["width"], photo["height"])
            output.update(evaluate_photo(photo["predictions"], truth))
            reviewed += 1
            if not truth:
                empty_truth += 1
                empty_correct += not photo["predictions"]
        elif state == "excluded":
            excluded += 1
        photos.append(output)
    total = len(photos)
    by_type = {category: aggregate(p["by_type"].get(category, metrics()) for p in photos)
               for category in baseline["selected_types"]}
    summary = {"metrics": aggregate(p["metrics"] for p in photos if p["metrics"] is not None),
        "by_type": by_type, "total_photos": total, "reviewed_photos": reviewed,
        "excluded_photos": excluded, "pending_photos": total - reviewed - excluded,
        "coverage": 100 * reviewed / (total - excluded) if total > excluded else None,
        "empty_truth_photos": empty_truth, "empty_correct_photos": empty_correct,
        "complete": total > 0 and reviewed > 0 and reviewed + excluded == total,
        "rule": RULE}
    return {"summary": summary, "photos": photos}


def current_evaluation(db: Session, task: DetectionTask, report: InspectionReport) -> tuple[QualityBaseline | None, dict]:
    baseline = db.scalar(select(QualityBaseline).where(QualityBaseline.detection_task_id == task.id))
    data = baseline.data_json if baseline else build_baseline(db, task)
    edits = list(db.scalars(select(AnnotationPhotoEdit).where(AnnotationPhotoEdit.report_id == report.id)))
    return baseline, evaluate_baseline(data, edits)


def persist_evaluation(db: Session, task: DetectionTask, report: InspectionReport, actor_id: UUID) -> QualityEvaluation | None:
    baseline, result = current_evaluation(db, task, report)
    if not result["summary"]["complete"] or report.quality_completed_revision != report.quality_revision:
        return None
    existing = db.scalar(select(QualityEvaluation).where(QualityEvaluation.report_id == report.id,
        QualityEvaluation.input_revision == report.quality_revision, QualityEvaluation.rule_version == RULE_VERSION))
    if existing is not None:
        return existing
    baseline = baseline or ensure_baseline(db, task)
    version = (db.scalar(select(func.max(QualityEvaluation.version)).where(QualityEvaluation.project_id == task.project_id)) or 0) + 1
    evaluation = QualityEvaluation(project_id=task.project_id, detection_task_id=task.id, report_id=report.id,
        baseline_id=baseline.id, version=version, input_revision=report.quality_revision,
        rule_version=RULE_VERSION, summary_json=result["summary"], photos_json=result["photos"], created_by=actor_id)
    db.add(evaluation)
    db.flush()
    return evaluation
