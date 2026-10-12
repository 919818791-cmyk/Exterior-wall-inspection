"""One uploaded YOLO weight version per process/container."""
from contextlib import asynccontextmanager
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError
import torch
from ultralytics import YOLO


WEIGHTS = Path("/weights/weights.pt")
VERSION_ID = os.environ["YOLO_VERSION_ID"]
MODEL_ID = os.environ["YOLO_MODEL_ID"]
VERSION = os.environ["YOLO_VERSION"]
SHA256 = os.environ["YOLO_WEIGHTS_SHA256"]
DEVICE = os.getenv("YOLO_DEVICE", "cuda:0")
model = None
prediction_lock = Lock()

# This file runs alone in each weight container; class IDs belong to that weight.
DEFECT_TYPES = {"crack", "spalling", "peeling", "damage", "hollow"}
CLASS_ALIASES = {
    "裂缝": "crack", "开裂": "crack", "wall_crack": "crack", "wall-crack": "crack",
    "missing": "spalling", "tile_missing": "spalling", "tile-missing": "spalling",
    "abscision": "spalling",
    "剥落": "spalling", "脱落": "spalling", "面砖剥落": "spalling", "面砖脱落": "spalling",
    "瓷砖剥落": "spalling", "瓷砖脱落": "spalling", "面砖缺失": "spalling",
    "起皮": "peeling", "面板破损": "damage", "破损": "damage",
    "空鼓": "hollow", "hollowing": "hollow",
}


def defect_type(class_name):
    name = str(class_name).strip().lower()
    return CLASS_ALIASES.get(name, name)


def selected_types(raw):
    try:
        values = json.loads(raw)
    except (ValueError, TypeError) as error:
        raise HTTPException(422, "models 必须为非空检测类型 JSON 数组。") from error
    if not isinstance(values, list) or not values or any(not isinstance(value, str) for value in values):
        raise HTTPException(422, "models 必须为非空检测类型 JSON 数组。")
    selected = list(dict.fromkeys(defect_type(value) for value in values))
    if set(selected).difference(DEFECT_TYPES):
        raise HTTPException(422, "models 包含不支持的检测类型。")
    return selected


@asynccontextmanager
async def lifespan(app):
    global model
    digest = hashlib.sha256()
    with WEIGHTS.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    if digest.hexdigest() != SHA256:
        raise RuntimeError("YOLO weight checksum does not match the registered version")
    if DEVICE.startswith("cuda") and not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable; refusing to silently switch to CPU")
    model = YOLO(str(WEIGHTS))
    model.predict(Image.new("RGB", (640, 640)), imgsz=640, device=DEVICE, verbose=False)
    yield
    model = None


app = FastAPI(title="Version-scoped YOLO runtime", lifespan=lifespan)


def identity():
    return {"model_id": MODEL_ID, "version_id": VERSION_ID, "model_version": VERSION, "sha256": SHA256}


@app.get("/health")
def health():
    return {**identity(), "status": "ok", "ready": model is not None, "device": DEVICE,
            "class_names": model.names if model else {}, "torch_version": torch.__version__}


@app.post("/predict")
def predict(file: UploadFile = File(), confidence: float = Form(0.25, ge=0, le=1),
            image_size: int = Form(1280, ge=32, le=4096), models: str = Form(...)):
    selected = selected_types(models)
    if model is None:
        raise HTTPException(503, "YOLO 模型尚未就绪。")
    names = model.names
    names = dict(enumerate(names)) if isinstance(names, (list, tuple)) else {int(key): value for key, value in names.items()}
    class_ids = [int(class_id) for class_id, name in names.items() if defect_type(name) in selected]
    available = {defect_type(names[class_id]) for class_id in names}
    missing = set(selected).difference(available)
    if missing:
        raise HTTPException(422, f"当前权重缺少所选检测类别：{', '.join(sorted(missing))}。")
    content = file.file.read(20 * 1024 * 1024 + 1)
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(413, "图片大小不能超过 20 MiB。")
    try:
        with Image.open(BytesIO(content)) as source:
            if source.width * source.height > 64_000_000:
                raise HTTPException(422, "图片像素过多。")
            image = source.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise HTTPException(422, "图片文件无法解码。") from error
    with prediction_lock:
        result = model.predict(image, conf=confidence, imgsz=image_size, device=DEVICE,
                               verbose=False, classes=class_ids)[0]
        detections = []
        if result.boxes is not None:
            for coordinates, score, class_id in zip(result.boxes.xyxy.cpu().tolist(),
                                                    result.boxes.conf.cpu().tolist(),
                                                    result.boxes.cls.cpu().tolist(), strict=True):
                class_id = int(class_id)
                # Enforce the request again even if a predictor returns extra boxes.
                if class_id not in class_ids:
                    continue
                x1, y1, x2, y2 = coordinates
                detections.append({"class_id": class_id, "class_name": names[class_id],
                                   "type": defect_type(names[class_id]),
                                   "confidence": score, "bbox": {"x": x1, "y": y1,
                                   "width": x2 - x1, "height": y2 - y1}})
    return {**identity(), "filename": file.filename, "image": {"width": image.width, "height": image.height},
            "device": DEVICE, "requested_models": selected, "executed_models": selected, "detections": detections}
