from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.schemas.phase5 import AlgorithmResultPayload


def test_phase5_routes_are_registered() -> None:
    paths = {route.path for route in app.routes}

    assert "/api/projects/{project_id}/start-detection" in paths
    assert "/api/algorithm/tasks/next" in paths
    assert "/api/algorithm/tasks/{task_id}/heartbeat" in paths
    assert "/api/algorithm/tasks/{task_id}/results" in paths
    assert "/api/algorithm/tasks/{task_id}/failed" in paths


def test_algorithm_task_next_requires_worker_credentials() -> None:
    client = TestClient(app)
    response = client.get("/api/algorithm/tasks/next", params={"model_version": "mock-test"})

    assert response.status_code == 401
    assert response.json()["message"] == "Worker credentials are required."


def test_algorithm_result_payload_accepts_fixed_json_contract() -> None:
    task_id = uuid4()
    project_id = uuid4()
    photo_id = uuid4()

    payload = AlgorithmResultPayload.model_validate(
        {
            "task_id": str(task_id),
            "project_id": str(project_id),
            "model_version": "mock-facade-detector-v1",
            "results": [
                {
                    "photo_id": str(photo_id),
                    "detections": [
                        {
                            "id": "mock-1",
                            "type": "crack",
                            "type_name": "裂缝",
                            "confidence": 0.91,
                            "bbox": {"x": 120, "y": 80, "width": 260, "height": 140},
                            "severity": "medium",
                            "description": "疑似外墙裂缝",
                        }
                    ],
                }
            ],
        }
    )

    assert payload.task_id == task_id
    assert payload.project_id == project_id
    assert payload.results[0].photo_id == photo_id
    assert payload.results[0].detections[0].type == "crack"
