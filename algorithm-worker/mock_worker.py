from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def env(name: str, default: str) -> str:
    return os.getenv(name, default).strip()


API_BASE_URL = env("WORKER_BACKEND_BASE_URL", "http://localhost:8000").rstrip("/")
WORKER_ID = env("WORKER_ID", "mock-worker-local")
WORKER_TOKEN = env("WORKER_TOKEN", "change-this-worker-token")
MODEL_VERSION = env("WORKER_MODEL_VERSION", "trial-crack-spalling-v1")
WORKER_MODE = env("WORKER_MODE", "mock").lower()
ALGORITHM_INFERENCE_URL = env("ALGORITHM_INFERENCE_URL", "http://algorithm-model:9002").rstrip("/")
ALGORITHM_INFERENCE_TIMEOUT_SECONDS = int(env("ALGORITHM_INFERENCE_TIMEOUT_SECONDS", "120"))

DEFECT_TYPE_NAMES = {
    "crack": "裂缝",
    "spalling": "剥落",
    "hollow": "空鼓",
}
DEFECT_ALIASES = {
    "crack": "crack",
    "裂缝": "crack",
    "开裂": "crack",
    "missing": "spalling",
    "spalling": "spalling",
    "剥落": "spalling",
    "面砖剥落": "spalling",
    "瓷砖剥落": "spalling",
    "面砖缺失": "spalling",
    "hollowing": "spalling",
    "hollow": "hollow",
    "空鼓": "hollow",
}
VISIBLE_DEFECT_TYPES = frozenset({"crack", "spalling"})


def api_url(path: str, params: dict[str, str] | None = None) -> str:
    normalized = path if path.startswith("/") else f"/{path}"
    query = f"?{urlencode(params)}" if params else ""
    return f"{API_BASE_URL}/api{normalized}{query}"


def request_json(
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    params: dict[str, str] | None = None,
) -> Any:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        api_url(path, params),
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json",
            "X-Worker-Id": WORKER_ID,
            "X-Worker-Token": WORKER_TOKEN,
        },
    )
    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} failed with {exc.code}: {body}") from exc
    except URLError as exc:
        raise RuntimeError(f"{method} {path} failed: {exc.reason}") from exc

    return json.loads(raw) if raw else None


def check_health() -> None:
    request = Request(api_url("/health"), method="GET")
    with urlopen(request, timeout=10) as response:
        payload = json.loads(response.read().decode("utf-8"))
    print(f"Backend health: {payload}")


def normalize_defect_type(value: object) -> str:
    text = str(value).strip()
    return DEFECT_ALIASES.get(text) or DEFECT_ALIASES.get(text.lower()) or text


def normalize_models(models: list[Any] | None) -> list[str]:
    normalized: list[str] = []
    for model in models or []:
        defect_type = normalize_defect_type(model)
        if defect_type in DEFECT_TYPE_NAMES and defect_type not in normalized:
            normalized.append(defect_type)
    return normalized or list(DEFECT_TYPE_NAMES)


def compatible_models_for_photo(photo: dict[str, Any], models: list[str]) -> list[str]:
    if photo.get("photo_type") == "thermal":
        return ["hollow"] if "hollow" in models else []
    return [model for model in models if model in VISIBLE_DEFECT_TYPES]


def download_photo_bytes(photo: dict[str, Any]) -> bytes:
    url = photo["download_url"]
    with urlopen(url, timeout=60) as response:
        content = response.read()
    print(f"Downloaded {len(content)} bytes for photo {photo['photo_id']}")
    return content


def download_photo(photo: dict[str, Any], skip_download: bool) -> int:
    if skip_download:
        print(f"Skip download for photo {photo['photo_id']}")
        return 0
    return len(download_photo_bytes(photo))


def multipart_body(
    fields: dict[str, str],
    file_field: str,
    filename: str,
    content_type: str,
    content: bytes,
) -> tuple[str, bytes]:
    boundary = f"----codex-worker-{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
                value.encode("utf-8"),
                b"\r\n",
            ]
        )
    chunks.extend(
        [
            f"--{boundary}\r\n".encode("utf-8"),
            (
                f'Content-Disposition: form-data; name="{file_field}"; '
                f'filename="{filename}"\r\n'
            ).encode("utf-8"),
            f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"),
            content,
            b"\r\n",
            f"--{boundary}--\r\n".encode("utf-8"),
        ]
    )
    return boundary, b"".join(chunks)


def request_inference(
    photo: dict[str, Any],
    content: bytes,
    models: list[str],
    high_precision: bool,
) -> dict[str, Any]:
    filename = str(photo.get("original_filename") or f"{photo['photo_id']}.jpg")
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    boundary, body = multipart_body(
        fields={
            "models": json.dumps(models, ensure_ascii=False),
            "high_precision": "true" if high_precision else "false",
        },
        file_field="file",
        filename=filename,
        content_type=content_type,
        content=content,
    )
    request = Request(
        f"{ALGORITHM_INFERENCE_URL}/predict",
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    try:
        with urlopen(request, timeout=ALGORITHM_INFERENCE_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Inference failed with {exc.code}: {body_text}") from exc
    except URLError as exc:
        raise RuntimeError(f"Inference request failed: {exc.reason}") from exc


def normalize_detection(detection: dict[str, Any]) -> dict[str, Any] | None:
    defect_type = normalize_defect_type(detection.get("type"))
    if defect_type not in DEFECT_TYPE_NAMES:
        print(f"Skip unsupported defect type from model: {detection.get('type')}", file=sys.stderr)
        return None
    bbox = detection.get("bbox")
    if not isinstance(bbox, dict):
        print(f"Skip detection without bbox: {detection.get('id')}", file=sys.stderr)
        return None
    try:
        confidence = float(detection.get("confidence"))
    except (TypeError, ValueError):
        print(f"Skip detection without valid confidence: {detection.get('id')}", file=sys.stderr)
        return None

    return {
        "id": detection.get("id"),
        "type": defect_type,
        "type_name": DEFECT_TYPE_NAMES[defect_type],
        "confidence": confidence,
        "bbox": bbox,
        "mask": detection.get("mask"),
        "severity": detection.get("severity"),
        "description": detection.get("description") or f"疑似{DEFECT_TYPE_NAMES[defect_type]}。",
    }


def build_mock_results(task: dict[str, Any]) -> dict[str, Any]:
    models = normalize_models(task.get("models"))
    now = datetime.now(UTC).isoformat()
    results: list[dict[str, Any]] = []
    for index, photo in enumerate(task.get("photos", [])):
        photo_models = compatible_models_for_photo(photo, models)
        detections: list[dict[str, Any]] = []
        if photo_models:
            selected_model = photo_models[0]
            detections.append(
                {
                    "id": f"mock-{index + 1}",
                    "type": selected_model,
                    "type_name": DEFECT_TYPE_NAMES[selected_model],
                    "confidence": 0.91,
                    "bbox": {
                        "x": 120 + index * 16,
                        "y": 80 + index * 12,
                        "width": 260,
                        "height": 140,
                    },
                    "mask": None,
                    "severity": "medium",
                    "description": f"模拟 Worker 固定结果：疑似{DEFECT_TYPE_NAMES[selected_model]}。",
                }
            )
        results.append(
            {
                "photo_id": photo["photo_id"],
                "detections": detections,
                "model_output": {
                    "requested_models": photo_models,
                    "executed_models": photo_models,
                    "detections": detections,
                },
            }
        )
    return {
        "task_id": task["task_id"],
        "project_id": task["project_id"],
        "model_version": MODEL_VERSION,
        "started_at": now,
        "finished_at": now,
        "results": results,
    }


def build_real_results(task: dict[str, Any]) -> dict[str, Any]:
    models = normalize_models(task.get("models"))
    started_at = datetime.now(UTC).isoformat()
    photo_results: list[dict[str, Any]] = []
    for photo in task.get("photos", []):
        photo_models = compatible_models_for_photo(photo, models)
        if not photo_models:
            photo_results.append(
                {
                    "photo_id": photo["photo_id"],
                    "detections": [],
                    "model_output": {
                        "requested_models": [],
                        "executed_models": [],
                        "detections": [],
                    },
                }
            )
            continue
        content = download_photo_bytes(photo)
        inference = request_inference(
            photo=photo,
            content=content,
            models=photo_models,
            high_precision=bool(task.get("high_precision")),
        )
        detections = [
            normalized
            for detection in inference.get("detections", [])
            if (
                (normalized := normalize_detection(detection)) is not None
                and normalized["type"] in photo_models
            )
        ]
        photo_results.append(
            {
                "photo_id": photo["photo_id"],
                "detections": detections,
                "model_output": {
                    "image": inference.get("image"),
                    "model_version": inference.get("model_version") or MODEL_VERSION,
                    "requested_models": photo_models,
                    "executed_models": inference.get("executed_models") or [],
                    "detections": detections,
                },
            }
        )
        print(f"Inference completed for photo {photo['photo_id']}: {len(detections)} detections")

    return {
        "task_id": task["task_id"],
        "project_id": task["project_id"],
        "model_version": MODEL_VERSION,
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "results": photo_results,
    }


def run_once(skip_download: bool) -> int:
    check_health()
    task = request_json(
        "GET",
        "/algorithm/tasks/next",
        params={"model_version": MODEL_VERSION},
    )
    if task is None:
        print("No pending detection task.")
        return 0

    print(f"Claimed task {task['task_id']} with {len(task.get('photos', []))} photos")
    try:
        if WORKER_MODE == "real":
            if skip_download:
                raise RuntimeError("--skip-download cannot be used with WORKER_MODE=real.")
            payload = build_real_results(task)
        else:
            for photo in task.get("photos", []):
                download_photo(photo, skip_download)
            payload = build_mock_results(task)

        request_json("POST", f"/algorithm/tasks/{task['task_id']}/heartbeat", payload={})
        response = request_json(
            "POST",
            f"/algorithm/tasks/{task['task_id']}/results",
            payload=payload,
        )
        print(f"Submitted results. Task status: {response['status']}")
        return 0
    except Exception as exc:
        reason = str(exc)
        print(f"Task failed locally: {reason}", file=sys.stderr)
        request_json(
            "POST",
            f"/algorithm/tasks/{task['task_id']}/failed",
            payload={"reason": reason, "detail": {"worker_id": WORKER_ID, "worker_mode": WORKER_MODE}},
        )
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Algorithm worker for backend task integration.")
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="Skip MinIO photo download check in WORKER_MODE=mock.",
    )
    args = parser.parse_args()
    return run_once(skip_download=args.skip_download)


if __name__ == "__main__":
    raise SystemExit(main())
