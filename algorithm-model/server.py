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
MODEL_VERSION = os.getenv("MODEL_VERSION", "trial-crack-missing-v1").strip() or "trial-crack-missing-v1"
MODEL_CONFIDENCE_THRESHOLD = float(os.getenv("MODEL_CONFIDENCE_THRESHOLD", "0.25"))
MODEL_IMAGE_SIZE = int(os.getenv("MODEL_IMAGE_SIZE", "1280"))
MODEL_HIGH_PRECISION_IMAGE_SIZE = int(os.getenv("MODEL_HIGH_PRECISION_IMAGE_SIZE", str(MODEL_IMAGE_SIZE)))

DEFECT_CLASS_ORDER = ("crack", "missing")
DEFECT_LABELS = {
    "crack": "裂缝",
    "missing": "面砖剥落",
}
DEFAULT_MODEL_PATHS = {
    "crack": "/models/wall_crack_yolo11x.pt",
    "missing": "/models/missing.pt",
}
CLASS_ALIASES = {
    "crack": "crack",
    "裂缝": "crack",
    "开裂": "crack",
    "wall_crack": "crack",
    "wall-crack": "crack",
    "missing": "missing",
    "tile_missing": "missing",
    "tile-missing": "missing",
    "面砖剥落": "missing",
    "瓷砖剥落": "missing",
    "面砖缺失": "missing",
}

app = FastAPI(title="Building Exterior Algorithm Model", version="0.3.0")

_models: dict[str, YOLO] = {}
_model_lock = Lock()


def _env_model_path(defect_type: str) -> str | None:
    env_name = f"{defect_type.upper()}_MODEL_WEIGHTS_PATH"
    value = os.getenv(env_name, "").strip()
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


def _bbox_from_xyxy(xyxy: list[float]) -> dict[str, float]:
    x1, y1, x2, y2 = xyxy
    return {
        "x": max(0.0, x1),
        "y": max(0.0, y1),
        "width": max(0.0, x2 - x1),
        "height": max(0.0, y2 - y1),
    }


def _target_model_types(selected_models: set[str]) -> list[str]:
    configured = _configured_model_paths()
    return [
        defect_type
        for defect_type in DEFECT_CLASS_ORDER
        if defect_type in configured and (not selected_models or defect_type in selected_models)
    ]


def _result_detections(result: Any, defect_type: str, detection_offset: int) -> list[dict[str, Any]]:
    detections: list[dict[str, Any]] = []
    boxes = getattr(result, "boxes", None)
    if boxes is None:
        return detections

    for index, box in enumerate(boxes):
        xyxy = [float(value) for value in box.xyxy[0].tolist()]
        confidence = float(box.conf[0].item())
        if confidence < MODEL_CONFIDENCE_THRESHOLD:
            continue

        detections.append(
            {
                "id": f"{defect_type}-{detection_offset + index + 1}",
                "type": defect_type,
                "type_name": DEFECT_LABELS[defect_type],
                "confidence": confidence,
                "bbox": _bbox_from_xyxy(xyxy),
                "mask": None,
                "severity": None,
                "description": f"疑似{DEFECT_LABELS[defect_type]}。",
            }
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
    return {"model_version": MODEL_VERSION, "models": models}


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

    detections: list[dict[str, Any]] = []
    try:
        for defect_type in target_model_types:
            model = _load_model(defect_type)
            results = model.predict(
                source=image,
                conf=MODEL_CONFIDENCE_THRESHOLD,
                imgsz=image_size,
                device=_device_for_predict(),
                verbose=False,
            )
            result = results[0] if results else None
            if result is not None:
                detections.extend(_result_detections(result, defect_type, len(detections)))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {
        "model_version": MODEL_VERSION,
        "filename": file.filename,
        "image": {"width": image.width, "height": image.height},
        "requested_models": sorted(selected_models),
        "executed_models": target_model_types,
        "detections": detections,
    }
