from app.main import app
from app.schemas.projects import ProjectCreateRequest


def test_phase3_project_routes_are_registered() -> None:
    paths = {route.path for route in app.routes}

    assert "/api/projects" in paths
    assert "/api/projects/{project_id}" in paths
    assert "/api/projects/{project_id}/buildings" in paths
    assert "/api/buildings/{building_id}" in paths
    assert "/api/buildings/{building_id}/facades" in paths
    assert "/api/facades/{facade_id}" in paths


def test_phase3_create_project_uses_server_owned_fields() -> None:
    fields = ProjectCreateRequest.model_fields

    assert "status" not in fields
    assert "created_by" not in fields
    assert "project_no" not in fields
    assert "longitude" in fields
    assert "latitude" in fields
