from __future__ import annotations

import json
import os
from io import BytesIO
from pathlib import Path
from threading import Lock
from typing import Any

import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image
from ultralytics import YOLO


MODEL_DEVICE = os.getenv("MODEL_DEVICE", "auto").strip() or "auto"
MODEL_VERSION = os.getenv("MODEL_VERSION", "trial-crack-spalling-v1").strip() or "trial-crack-spalling-v1"
MODEL_CONFIDENCE_THRESHOLD = float(os.getenv("MODEL_CONFIDENCE_THRESHOLD", "0.25"))
MODEL_IMAGE_SIZE = int(os.getenv("MODEL_IMAGE_SIZE", "1280"))
MODEL_HIGH_PRECISION_IMAGE_SIZE = int(os.getenv("MODEL_HIGH_PRECISION_IMAGE_SIZE", str(MODEL_IMAGE_SIZE)))


def _env_flag(name: str, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() not in {"0", "false", "no", "off", "disabled"}


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    return max(minimum, int(os.getenv(name, str(default))))


def _env_float(name: str, default: float, minimum: float, maximum: float) -> float:
    value = float(os.getenv(name, str(default)))
    return min(maximum, max(minimum, value))


MODEL_TILED_INFERENCE_ENABLED = _env_flag("MODEL_TILED_INFERENCE_ENABLED", True)
MODEL_TILE_SIZE = _env_int("MODEL_TILE_SIZE", MODEL_IMAGE_SIZE, minimum=64)
MODEL_HIGH_PRECISION_TILE_SIZE = _env_int(
    "MODEL_HIGH_PRECISION_TILE_SIZE",
    int(os.getenv("MODEL_TILE_SIZE", str(MODEL_HIGH_PRECISION_IMAGE_SIZE))),
    minimum=64,
)
MODEL_TILE_OVERLAP_RATIO = _env_float("MODEL_TILE_OVERLAP_RATIO", 0.25, minimum=0.0, maximum=0.85)
MODEL_TILE_NMS_IOU_THRESHOLD = _env_float("MODEL_TILE_NMS_IOU_THRESHOLD", 0.5, minimum=0.0, maximum=1.0)

DEFECT_CLASS_ORDER = ("crack", "spalling")
DEFECT_LABELS = {
    "crack": "裂缝",
    "spalling": "剥落",
}
DEFAULT_MODEL_PATHS = {
    "crack": "/models/wall_crack_yolo11x.pt",
    "spalling": "/models/missing.pt",
}
CLASS_ALIASES = {
    "crack": "crack",
    "裂缝": "crack",
    "开裂": "crack",
    "wall_crack": "crack",
    "wall-crack": "crack",
    "missing": "spalling",
    "tile_missing": "spalling",
    "tile-missing": "spalling",
    "spalling": "spalling",
    "剥落": "spalling",
    "面砖剥落": "spalling",
    "瓷砖剥落": "spalling",
    "面砖缺失": "spalling",
}

app = FastAPI(title="Building Exterior Algorithm Model", version="0.4.0")

_models: dict[str, YOLO] = {}
_model_lock = Lock()


def _env_model_path(defect_type: str) -> str | None:
    env_name = f"{defect_type.upper()}_MODEL_WEIGHTS_PATH"
    value = os.getenv(env_name, "").strip()
    if not value and defect_type == "spalling":
        value = os.getenv("MISSING_MODEL_WEIGHTS_PATH", "").strip()
    return value or None


def _configured_model_paths() -> dict[str, Path]:
    paths: dict[str, Path] = {}
    raw_config = os.getenv("MODEL_WEIGHTS_CONFIG", "").strip()
    if raw_config:
        try:
            parsed = json.loads(raw_config)
        except json.JSONDecodeError as exc:
            raise RuntimeError("MODEL_WEIGHTS_CONFIG must be valid JSON.") from exc
        if not isinstance(parsed, dict):
            raise RuntimeError("MODEL_WEIGHTS_CONFIG must be a JSON object.")
        for raw_key, raw_path in parsed.items():
            defect_type = _normalize_class_name(raw_key)
            if defect_type in DEFECT_LABELS and str(raw_path).strip():
                paths[defect_type] = Path(str(raw_path).strip())

    for defect_type, default_path in DEFAULT_MODEL_PATHS.items():
        paths[defect_type] = Path(_env_model_path(defect_type) or str(paths.get(defect_type) or default_path))

    return paths


def cuda_summary() -> dict[str, Any]:
    available = torch.cuda.is_available()
    return {
        "available": available,
        "torch_cuda_version": torch.version.cuda,
        "device_count": torch.cuda.device_count() if available else 0,
        "devices": [
            {
                "index": index,
                "name": torch.cuda.get_device_name(index),
                "capability": torch.cuda.get_device_capability(index),
            }
            for index in range(torch.cuda.device_count())
        ] if available else [],
    }


def _device_for_predict() -> str | int:
    if MODEL_DEVICE == "auto":
        return 0 if torch.cuda.is_available() else "cpu"
    if MODEL_DEVICE in {"cuda", "gpu"}:
        return 0
    return MODEL_DEVICE


def _load_model(defect_type: str) -> YOLO:
    if defect_type in _models:
        return _models[defect_type]
    paths = _configured_model_paths()
    path = paths.get(defect_type)
    if path is None:
        raise FileNotFoundError(f"No model configured for defect type: {defect_type}")
    with _model_lock:
        if defect_type not in _models:
            if not path.exists():
                raise FileNotFoundError(f"Model weights not found for {defect_type}: {path}")
            _models[defect_type] = YOLO(str(path))
    return _models[defect_type]


def _model_names(model: YOLO) -> dict[int, str]:
    names = getattr(model, "names", {}) or {}
    if isinstance(names, dict):
        return {int(key): str(value) for key, value in names.items()}
    return {index: str(value) for index, value in enumerate(names)}


def _normalize_class_name(value: object, class_id: int | None = None) -> str:
    name = str(value).strip()
    normalized = CLASS_ALIASES.get(name) or CLASS_ALIASES.get(name.lower())
    if normalized:
        return normalized
    if class_id is not None and 0 <= class_id < len(DEFECT_CLASS_ORDER):
        return DEFECT_CLASS_ORDER[class_id]
    return name


def _parse_selected_models(raw_models: str) -> set[str]:
    if not raw_models:
        return set()
    try:
        parsed = json.loads(raw_models)
    except json.JSONDecodeError:
        parsed = [item.strip() for item in raw_models.split(",")]
    if not isinstance(parsed, list):
        return set()
    return {
        _normalize_class_name(item)
        for item in parsed
        if str(item).strip()
    }


def _open_image(content: bytes) -> Image.Image:
    try:
        return Image.open(BytesIO(content)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid image file.") from exc


def _clip_xyxy(
    xyxy: list[float],
    image_width: int | None = None,
    image_height: int | None = None,
) -> list[float] | None:
    x1, y1, x2, y2 = xyxy
    if image_width is not None:
        x1 = min(float(image_width), max(0.0, x1))
        x2 = min(float(image_width), max(0.0, x2))
    if image_height is not None:
        y1 = min(float(image_height), max(0.0, y1))
        y2 = min(float(image_height), max(0.0, y2))
    if x2 <= x1 or y2 <= y1:
        return None
    return [x1, y1, x2, y2]


def _bbox_from_xyxy(xyxy: list[float]) -> dict[str, float]:
    x1, y1, x2, y2 = xyxy
    return {
        "x": max(0.0, x1),
        "y": max(0.0, y1),
        "width": max(0.0, x2 - x1),
        "height": max(0.0, y2 - y1),
    }


def _xyxy_from_bbox(bbox: dict[str, Any]) -> list[float]:
    x1 = float(bbox.get("x", 0.0))
    y1 = float(bbox.get("y", 0.0))
    return [
        x1,
        y1,
        x1 + float(bbox.get("width", 0.0)),
        y1 + float(bbox.get("height", 0.0)),
    ]


def _bbox_iou(left: dict[str, Any], right: dict[str, Any]) -> float:
    left_x1, left_y1, left_x2, left_y2 = _xyxy_from_bbox(left)
    right_x1, right_y1, right_x2, right_y2 = _xyxy_from_bbox(right)
    intersection_width = max(0.0, min(left_x2, right_x2) - max(left_x1, right_x1))
    intersection_height = max(0.0, min(left_y2, right_y2) - max(left_y1, right_y1))
    intersection_area = intersection_width * intersection_height
    if intersection_area <= 0:
        return 0.0
    left_area = max(0.0, left_x2 - left_x1) * max(0.0, left_y2 - left_y1)
    right_area = max(0.0, right_x2 - right_x1) * max(0.0, right_y2 - right_y1)
    union_area = left_area + right_area - intersection_area
    return intersection_area / union_area if union_area > 0 else 0.0


def _confidence_value(detection: dict[str, Any]) -> float:
    try:
        return float(detection.get("confidence", 0.0))
    except (TypeError, ValueError):
        return 0.0


def _nms_detections(detections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    remaining = sorted(detections, key=_confidence_value, reverse=True)
    while remaining:
        current = remaining.pop(0)
        kept.append(current)
        current_bbox = current.get("bbox") if isinstance(current.get("bbox"), dict) else None
        if current_bbox is None:
            continue
        remaining = [
            candidate
            for candidate in remaining
            if not isinstance(candidate.get("bbox"), dict)
            or _bbox_iou(current_bbox, candidate["bbox"]) <= MODEL_TILE_NMS_IOU_THRESHOLD
        ]
    return kept


def _merge_detections(detections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    known_types = list(DEFECT_CLASS_ORDER)
    extra_types = sorted({
        str(detection.get("type"))
        for detection in detections
        if str(detection.get("type")) not in known_types
    })

    for defect_type in [*known_types, *extra_types]:
        type_detections = [
            detection
            for detection in detections
            if str(detection.get("type")) == defect_type
        ]
        merged.extend(_nms_detections(type_detections))

    counters: dict[str, int] = {}
    for detection in merged:
        defect_type = str(detection.get("type") or "detection")
        counters[defect_type] = counters.get(defect_type, 0) + 1
        detection["id"] = f"{defect_type}-{counters[defect_type]}"
    return merged


def _box_class_id(box: Any) -> int | None:
    raw_class = getattr(box, "cls", None)
    if raw_class is None:
        return None
    try:
        return int(raw_class[0].item())
    except (AttributeError, IndexError, TypeError, ValueError):
        try:
            return int(raw_class)
        except (TypeError, ValueError):
            return None


def _result_class_name(result: Any, class_id: int) -> str | None:
    names = getattr(result, "names", {}) or {}
    if isinstance(names, dict):
        raw_name = names.get(class_id, names.get(str(class_id)))
    else:
        try:
            raw_name = names[class_id]
        except (IndexError, TypeError):
            raw_name = None
    return None if raw_name is None else str(raw_name)


def _result_defect_type(result: Any, box: Any) -> str | None:
    class_id = _box_class_id(box)
    if class_id is None:
        return None
    class_name = _result_class_name(result, class_id)
    if class_name is None:
        return None
    return _normalize_class_name(class_name)


def _target_model_types(selected_models: set[str]) -> list[str]:
    configured = _configured_model_paths()
    return [
        defect_type
        for defect_type in DEFECT_CLASS_ORDER
        if defect_type in configured and (not selected_models or defect_type in selected_models)
    ]


def _result_detections(
    result: Any,
    defect_type: str,
    detection_offset: int,
    offset_x: float = 0.0,
    offset_y: float = 0.0,
    image_width: int | None = None,
    image_height: int | None = None,
) -> list[dict[str, Any]]:
    detections: list[dict[str, Any]] = []
    boxes = getattr(result, "boxes", None)
    if boxes is None:
        return detections

    for index, box in enumerate(boxes):
        detected_type = _result_defect_type(result, box)
        if detected_type is not None and detected_type != defect_type:
            continue

        xyxy = [float(value) for value in box.xyxy[0].tolist()]
        xyxy = [
            xyxy[0] + offset_x,
            xyxy[1] + offset_y,
            xyxy[2] + offset_x,
            xyxy[3] + offset_y,
        ]
        clipped_xyxy = _clip_xyxy(xyxy, image_width=image_width, image_height=image_height)
        if clipped_xyxy is None:
            continue

        confidence = float(box.conf[0].item())
        if confidence < MODEL_CONFIDENCE_THRESHOLD:
            continue

        detections.append(
            {
                "id": f"{defect_type}-{detection_offset + index + 1}",
                "type": defect_type,
                "type_name": DEFECT_LABELS[defect_type],
                "confidence": confidence,
                "bbox": _bbox_from_xyxy(clipped_xyxy),
                "mask": None,
                "severity": None,
                "description": f"疑似{DEFECT_LABELS[defect_type]}。",
            }
        )
    return detections


def _tile_starts(length: int, tile_size: int, overlap_ratio: float) -> list[int]:
    if length <= tile_size:
        return [0]

    overlap_pixels = int(round(tile_size * overlap_ratio))
    step = max(1, tile_size - overlap_pixels)
    last_start = length - tile_size
    starts = list(range(0, last_start + 1, step))
    if starts[-1] != last_start:
        starts.append(last_start)
    return sorted(set(starts))


def _image_tiles(image: Image.Image, tile_size: int) -> list[tuple[int, int, Image.Image]]:
    tiles: list[tuple[int, int, Image.Image]] = []
    for y in _tile_starts(image.height, tile_size, MODEL_TILE_OVERLAP_RATIO):
        for x in _tile_starts(image.width, tile_size, MODEL_TILE_OVERLAP_RATIO):
            right = min(image.width, x + tile_size)
            lower = min(image.height, y + tile_size)
            tiles.append((x, y, image.crop((x, y, right, lower))))
    return tiles


def _tile_count(image: Image.Image, tile_size: int) -> int:
    return (
        len(_tile_starts(image.width, tile_size, MODEL_TILE_OVERLAP_RATIO))
        * len(_tile_starts(image.height, tile_size, MODEL_TILE_OVERLAP_RATIO))
    )


def _predict_result(model: YOLO, image: Image.Image, image_size: int) -> Any | None:
    results = model.predict(
        source=image,
        conf=MODEL_CONFIDENCE_THRESHOLD,
        imgsz=image_size,
        device=_device_for_predict(),
        verbose=False,
    )
    return results[0] if results else None


def _predict_full_image(
    model: YOLO,
    defect_type: str,
    image: Image.Image,
    image_size: int,
    detection_offset: int,
) -> list[dict[str, Any]]:
    result = _predict_result(model, image, image_size)
    if result is None:
        return []
    return _result_detections(
        result,
        defect_type,
        detection_offset,
        image_width=image.width,
        image_height=image.height,
    )


def _predict_tiled_image(
    model: YOLO,
    defect_type: str,
    image: Image.Image,
    image_size: int,
    tile_size: int,
    detection_offset: int,
) -> list[dict[str, Any]]:
    detections: list[dict[str, Any]] = []
    for tile_x, tile_y, tile in _image_tiles(image, tile_size):
        result = _predict_result(model, tile, image_size)
        if result is None:
            continue
        detections.extend(
            _result_detections(
                result,
                defect_type,
                detection_offset + len(detections),
                offset_x=tile_x,
                offset_y=tile_y,
                image_width=image.width,
                image_height=image.height,
            )
        )
    return detections


def _model_metadata(load: bool = False) -> dict[str, Any]:
    paths = _configured_model_paths()
    models = {}
    for defect_type, path in paths.items():
        metadata: dict[str, Any] = {
            "label": DEFECT_LABELS[defect_type],
            "weights_path": str(path),
            "weights_exists": path.exists(),
            "loaded": defect_type in _models,
        }
        if load and path.exists():
            model = _load_model(defect_type)
            names = _model_names(model)
            metadata.update(
                {
                    "class_names": names,
                    "normalized_classes": {
                        str(class_id): _normalize_class_name(name, class_id)
                        for class_id, name in names.items()
                    },
                }
            )
        models[defect_type] = metadata
    return {
        "model_version": MODEL_VERSION,
        "inference": {
            "tiled_enabled": MODEL_TILED_INFERENCE_ENABLED,
            "tile_size": MODEL_TILE_SIZE,
            "high_precision_tile_size": MODEL_HIGH_PRECISION_TILE_SIZE,
            "tile_overlap_ratio": MODEL_TILE_OVERLAP_RATIO,
            "tile_nms_iou_threshold": MODEL_TILE_NMS_IOU_THRESHOLD,
        },
        "models": models,
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "torch_version": torch.__version__,
        "cuda": cuda_summary(),
        "model_device": MODEL_DEVICE,
        "predict_device": _device_for_predict(),
        **_model_metadata(load=False),
    }


@app.get("/ready")
def ready() -> dict[str, Any]:
    try:
        metadata = _model_metadata(load=True)
    except Exception as exc:
        return {"ready": False, "error": str(exc), **_model_metadata(load=False)}
    all_ready = all(item["weights_exists"] for item in metadata["models"].values())
    return {"ready": all_ready, **metadata}


@app.get("/metadata")
def metadata() -> dict[str, Any]:
    try:
        return _model_metadata(load=True)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    models: str = Form("[]"),
    high_precision: bool = Form(False),
) -> dict[str, Any]:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Image file is empty.")

    image = _open_image(content)
    selected_models = _parse_selected_models(models)
    target_model_types = _target_model_types(selected_models)
    image_size = MODEL_HIGH_PRECISION_IMAGE_SIZE if high_precision else MODEL_IMAGE_SIZE
    tile_size = MODEL_HIGH_PRECISION_TILE_SIZE if high_precision else MODEL_TILE_SIZE
    use_tiled_inference = MODEL_TILED_INFERENCE_ENABLED

    detections: list[dict[str, Any]] = []
    try:
        for defect_type in target_model_types:
            model = _load_model(defect_type)
            if use_tiled_inference:
                detections.extend(
                    _predict_tiled_image(
                        model,
                        defect_type,
                        image,
                        image_size,
                        tile_size,
                        len(detections),
                    )
                )
            else:
                detections.extend(
                    _predict_full_image(
                        model,
                        defect_type,
                        image,
                        image_size,
                        len(detections),
                    )
                )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    detections = _merge_detections(detections)

    return {
        "model_version": MODEL_VERSION,
        "filename": file.filename,
        "image": {"width": image.width, "height": image.height},
        "inference": {
            "mode": "tiled" if use_tiled_inference else "full",
            "image_size": image_size,
            "tile_size": tile_size if use_tiled_inference else None,
            "tile_overlap_ratio": MODEL_TILE_OVERLAP_RATIO if use_tiled_inference else None,
            "tile_count": _tile_count(image, tile_size) if use_tiled_inference else 1,
            "nms_iou_threshold": MODEL_TILE_NMS_IOU_THRESHOLD,
        },
        "requested_models": sorted(selected_models),
        "executed_models": target_model_types,
        "detections": detections,
    }
