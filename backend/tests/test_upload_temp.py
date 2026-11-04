import tempfile
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user
from app.core.upload_temp import configure_upload_temp_directory
from app.main import app


def test_upload_temp_replaces_unusable_cached_directory(monkeypatch, tmp_path):
    directory = tmp_path / "private" / "uploads"
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path / "unavailable"))
    monkeypatch.setattr(
        "app.core.upload_temp.get_settings",
        lambda: SimpleNamespace(upload_temp_dir=str(directory)),
    )

    assert configure_upload_temp_directory() == directory
    with tempfile.SpooledTemporaryFile(max_size=1024) as upload:
        upload.write(b"x" * 2048)
        upload.seek(0)
        assert upload.read() == b"x" * 2048
    assert list(directory.iterdir()) == []


@pytest.mark.parametrize("path", ["/api/trial/photos", "/api/photos/upload"])
@pytest.mark.parametrize("size", [1024, 2 * 1024 * 1024])
def test_multipart_upload_reaches_route_after_spooling(monkeypatch, tmp_path, path, size):
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path / "unavailable"))
    monkeypatch.setattr(
        "app.core.upload_temp.get_settings",
        lambda: SimpleNamespace(upload_temp_dir=str(tmp_path / "uploads")),
    )
    monkeypatch.setattr("app.api.detection_tasks.schedule_queued_formal_detections", lambda: None)

    async def stop_jobs():
        pass

    monkeypatch.setattr("app.api.detection_tasks.stop_formal_detection_jobs", stop_jobs)

    def require_auth():
        raise HTTPException(401, "Upload parsed; authentication required.")

    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_current_user] = require_auth
    try:
        with TestClient(app) as client:
            response = client.post(path, files={"file": ("photo.jpg", b"x" * size, "image/jpeg")})
        assert response.status_code == 401
        assert response.json()["message"] == "Upload parsed; authentication required."
        assert list((tmp_path / "uploads").iterdir()) == []
    finally:
        app.dependency_overrides = previous_overrides


def test_upload_temp_fails_startup_for_invalid_directory(monkeypatch, tmp_path):
    target = tmp_path / "file"
    target.write_bytes(b"not a directory")
    monkeypatch.setattr(
        "app.core.upload_temp.get_settings",
        lambda: SimpleNamespace(upload_temp_dir=str(target)),
    )
    with pytest.raises(FileExistsError):
        configure_upload_temp_directory()
