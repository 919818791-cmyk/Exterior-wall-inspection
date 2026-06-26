from __future__ import annotations

import argparse
import json
import os
import sys
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
MODEL_VERSION = env("WORKER_MODEL_VERSION", "mock-facade-detector-v1")


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


def download_photo(photo: dict[str, Any], skip_download: bool) -> int:
    if skip_download:
        print(f"Skip download for photo {photo['photo_id']}")
        return 0
    url = photo["download_url"]
    with urlopen(url, timeout=60) as response:
        content = response.read()
    print(f"Downloaded {len(content)} bytes for photo {photo['photo_id']}")
    return len(content)


def build_mock_results(task: dict[str, Any]) -> dict[str, Any]:
    selected_model = task["models"][0] if task.get("models") else "crack"
    type_names = {
        "crack": "裂缝",
        "spalling": "剥落",
        "hollowing": "空鼓",
        "leakage": "渗漏",
        "corrosion": "锈蚀",
    }
    now = datetime.now(UTC).isoformat()
    return {
        "task_id": task["task_id"],
        "project_id": task["project_id"],
        "model_version": MODEL_VERSION,
        "started_at": now,
        "finished_at": now,
        "results": [
            {
                "photo_id": photo["photo_id"],
                "detections": [
                    {
                        "id": f"mock-{index + 1}",
                        "type": selected_model,
                        "type_name": type_names.get(selected_model, selected_model),
                        "confidence": 0.91,
                        "bbox": {
                            "x": 120 + index * 16,
                            "y": 80 + index * 12,
                            "width": 260,
                            "height": 140,
                        },
                        "mask": None,
                        "severity": "medium",
                        "description": f"模拟 Worker 固定结果：疑似{type_names.get(selected_model, selected_model)}。",
                    }
                ],
            }
            for index, photo in enumerate(task.get("photos", []))
        ],
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
        for photo in task.get("photos", []):
            download_photo(photo, skip_download)
        request_json("POST", f"/algorithm/tasks/{task['task_id']}/heartbeat", payload={})
        response = request_json(
            "POST",
            f"/algorithm/tasks/{task['task_id']}/results",
            payload=build_mock_results(task),
        )
        print(f"Submitted results. Task status: {response['status']}")
        return 0
    except Exception as exc:
        reason = str(exc)
        print(f"Task failed locally: {reason}", file=sys.stderr)
        request_json(
            "POST",
            f"/algorithm/tasks/{task['task_id']}/failed",
            payload={"reason": reason, "detail": {"worker_id": WORKER_ID}},
        )
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Mock algorithm worker for phase 5 integration.")
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="Skip MinIO photo download check and only exercise the API contract.",
    )
    args = parser.parse_args()
    return run_once(skip_download=args.skip_download)


if __name__ == "__main__":
    raise SystemExit(main())
