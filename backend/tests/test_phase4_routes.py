from app.main import app
from app.schemas.phase4 import DetectionConfigUpdateRequest


def test_phase4_routes_are_registered() -> None:
    paths = {route.path for route in app.routes}

    assert "/api/projects/{project_id}/upload-batches" in paths
    assert "/api/photos/upload" in paths
    assert "/api/projects/{project_id}/photos" in paths
    assert "/api/photos/{photo_id}" in paths
    assert "/api/projects/{project_id}/detection-config" in paths


def test_detection_config_requires_at_least_one_model() -> None:
    assert DetectionConfigUpdateRequest.model_fields["model_types"].metadata
