from datetime import UTC, datetime
from io import BytesIO
import time
from types import SimpleNamespace
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from minio.error import S3Error
import pytest
from urllib3.exceptions import HTTPError

from app.api import object_storage as storage_api
from app.services import object_storage

from sample_data import fixture_url


def test_presigned_url_uses_public_minio_endpoint(monkeypatch) -> None:
    settings = SimpleNamespace(
        minio_endpoint="127.0.0.1:9002",
        minio_public_url=fixture_url('inspection.example', scheme='http'),
        minio_access_key="test-access-key",
        minio_secret_key="test-secret-key",
    )
    monkeypatch.setattr(object_storage, "get_settings", lambda: settings)

    url = object_storage.presigned_get_url(
        "building-exterior",
        "photos/facade.jpg",
    )

    assert url is not None
    parsed = urlsplit(url)
    assert parsed.scheme == "http"
    assert parsed.netloc == "inspection.example"
    assert parsed.path == "/building-exterior/photos/facade.jpg"


def test_app_signed_url_is_stable_within_cache_window(monkeypatch) -> None:
    settings = SimpleNamespace(auth_secret_key="test-signing-secret")
    monkeypatch.setattr(object_storage, "get_settings", lambda: settings)
    monkeypatch.setattr(object_storage.time, "time", lambda: 1_800_000_100)
    first = object_storage.signed_object_url(
        fixture_url('inspection.example', '/api'),
        "building-exterior",
        "photos/facade.jpg",
    )
    monkeypatch.setattr(object_storage.time, "time", lambda: 1_800_000_900)
    second = object_storage.signed_object_url(
        fixture_url('inspection.example', '/api'),
        "building-exterior",
        "photos/facade.jpg",
    )

    assert first == second


@pytest.fixture
def storage_client():
    app = FastAPI()
    app.include_router(storage_api.router, prefix="/api")
    with TestClient(app, base_url=fixture_url('inspection.example', scheme='http')) as client:
        yield client


class ObjectResponse(BytesIO):
    def __init__(self, body: bytes, *, partial: bool = False):
        super().__init__(body)
        self.status = 206 if partial else 200
        self.headers = {
            "Content-Type": "image/jpeg",
            "Content-Length": str(len(body)),
            "ETag": '"object-etag"',
        }
        if partial:
            self.headers["Content-Range"] = "bytes 0-3/100"
        self.releases = 0

    def release_conn(self):
        self.releases += 1


@pytest.mark.parametrize("byte_range", [None, "bytes=0-3"])
def test_signed_object_streams_on_application_origin(storage_client, monkeypatch, byte_range):
    body = b"\xff\xd8\xff\xd9" if byte_range else b"\xff\xd8" + b"image" * 250_000 + b"\xff\xd9"
    upstream = ObjectResponse(body, partial=byte_range is not None)
    calls = []

    def open_object(bucket, key, **kwargs):
        calls.append((bucket, key, kwargs))
        return upstream

    monkeypatch.setattr(storage_api, "open_object", open_object)
    url = object_storage.signed_object_url("/api", "inspection", "photos/外墙.jpg")
    response = storage_client.get(url, headers={"Range": byte_range} if byte_range else {})

    assert response.status_code == (206 if byte_range else 200)
    assert response.content == body
    assert response.headers["Content-Type"] == "image/jpeg"
    assert response.headers["Content-Length"] == str(len(body))
    assert response.headers["Accept-Ranges"] == "bytes"
    assert response.headers["X-Accel-Buffering"] == "no"
    assert response.headers["ETag"] == '"object-etag"'
    assert response.headers["Cache-Control"].startswith("private, max-age=")
    assert "Location" not in response.headers
    if byte_range:
        assert response.headers["Content-Range"] == "bytes 0-3/100"
    assert calls == [("inspection", "photos/外墙.jpg", {"byte_range": byte_range})]
    assert upstream.closed
    assert upstream.releases == 1


@pytest.mark.parametrize("invalid", ["expired", "tampered-signature", "tampered-key"])
def test_signed_object_rejects_invalid_access_before_reading_storage(storage_client, monkeypatch, invalid):
    def unexpected_read(*args, **kwargs):
        pytest.fail("invalid signatures must not reach object storage")

    monkeypatch.setattr(storage_api, "open_object", unexpected_read)
    expires = int(time.time()) - 10 if invalid == "expired" else int(time.time()) + 60
    signature = object_storage.sign_object_access("inspection", "photos/facade.jpg", expires)
    if invalid == "tampered-signature":
        signature = "invalid"
    key = "photos/another.jpg" if invalid == "tampered-key" else "photos/facade.jpg"
    response = storage_client.get(f"/api/object-storage/inspection/{key}", params={
        "expires": expires, "signature": signature,
    })
    assert response.status_code == 403


@pytest.mark.parametrize("code,expected_status", [
    ("NoSuchKey", 404), ("NoSuchBucket", 404), ("InvalidRange", 416), ("AccessDenied", 502),
])
def test_signed_object_maps_storage_errors(storage_client, monkeypatch, code, expected_status):
    def fail(*args, **kwargs):
        raise S3Error(
            response=None, code=code, message="storage error", resource="object",
            request_id="request", host_id="host",
        )

    monkeypatch.setattr(storage_api, "open_object", fail)
    response = storage_client.get(object_storage.signed_object_url("/api", "inspection", "photos/facade.jpg"))
    assert response.status_code == expected_status


def test_signed_object_handles_storage_connection_failure(storage_client, monkeypatch):
    def fail(*args, **kwargs):
        raise HTTPError("connection failed")

    monkeypatch.setattr(storage_api, "open_object", fail)
    response = storage_client.get(object_storage.signed_object_url("/api", "inspection", "photos/facade.jpg"))
    assert response.status_code == 502


@pytest.mark.parametrize("module_name", ["photos", "review"])
def test_photo_detail_urls_use_application_proxy(module_name):
    from app.api import photos, review
    from app.models.tables import Photo

    now = datetime.now(UTC)
    photo = Photo(
        id=uuid4(), project_id=uuid4(), upload_batch_id=uuid4(),
        original_filename="facade.jpg", storage_bucket="inspection",
        storage_object_key="photos/facade.jpg", thumbnail_object_key="photos/facade.thumb.webp",
        photo_type="visible", status="uploaded", precheck_status="pending", precheck_attempts=0,
        created_at=now, updated_at=now,
    )
    result = {"photos": photos, "review": review}[module_name]._photo_to_read(photo)
    assert result.preview_url.startswith("/api/object-storage/inspection/photos/facade.jpg?")
    assert result.thumbnail_url.startswith("/api/object-storage/inspection/photos/facade.thumb.webp?")
