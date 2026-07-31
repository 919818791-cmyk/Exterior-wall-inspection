from types import SimpleNamespace
from urllib.parse import urlsplit

from app.services import object_storage


def test_presigned_url_uses_public_minio_endpoint(monkeypatch) -> None:
    settings = SimpleNamespace(
        minio_endpoint="127.0.0.1:9002",
        minio_public_url="http://inspection.example",
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

