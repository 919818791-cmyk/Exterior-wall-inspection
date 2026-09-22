from types import SimpleNamespace
from uuid import uuid4

from app.services import photo_precheck
from app.services.photo_guard import PhotoGuardResult, PhotoGuardUnavailable


class FakeDb:
    def __init__(self) -> None:
        self.commit_count = 0

    def commit(self) -> None:
        self.commit_count += 1

    def refresh(self, _: object) -> None:
        return None


def _photo() -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        original_filename="facade.jpg",
        storage_bucket="photos",
        storage_object_key="projects/one/facade.jpg",
        precheck_status="pending",
        precheck_category=None,
        precheck_reason=None,
        precheck_model=None,
        precheck_error=None,
        precheck_attempts=0,
        prechecked_at=None,
        image_width=None,
        image_height=None,
    )


def _settings() -> SimpleNamespace:
    return SimpleNamespace(
        photo_guard_enabled=True,
        photo_guard_model="guard-test",
    )


def test_stored_photo_is_read_from_minio_before_it_passes(monkeypatch) -> None:
    photo = _photo()
    db = FakeDb()
    storage_reads: list[tuple[str, str]] = []
    captured_prompt: list[str] = []

    monkeypatch.setattr(photo_precheck, "get_settings", _settings)
    monkeypatch.setattr(
        photo_precheck,
        "get_object_bytes",
        lambda bucket, key: storage_reads.append((bucket, key)) or b"stored-original",
    )
    monkeypatch.setattr(
        photo_precheck,
        "classify_building_photo",
        lambda *args, **kwargs: captured_prompt.append(kwargs["prompt"]) or PhotoGuardResult(
            allowed=True,
            is_building=True,
            category="BUILDING",
            reason="建筑照片",
            source_width=2048,
            source_height=1536,
            inference_width=1280,
            inference_height=960,
            inference_bytes=1234,
            latency_ms=25,
            model="guard-test",
        ),
    )
    monkeypatch.setattr(
        photo_precheck,
        "trial_prompts",
        lambda _: SimpleNamespace(photo_guard_prompt="管理员配置的建筑照片相关性提示词"),
    )

    photo_precheck.run_stored_photo_precheck(db, photo)

    assert storage_reads == [("photos", "projects/one/facade.jpg")]
    assert captured_prompt == ["管理员配置的建筑照片相关性提示词"]
    assert photo.precheck_status == "passed"
    assert photo.precheck_attempts == 1
    assert photo.image_width == 2048
    assert photo.image_height == 1536
    assert db.commit_count == 2


def test_model_timeout_is_recorded_without_deleting_original(monkeypatch) -> None:
    photo = _photo()
    db = FakeDb()
    monkeypatch.setattr(photo_precheck, "get_settings", _settings)
    monkeypatch.setattr(photo_precheck, "get_object_bytes", lambda *args: b"stored-original")

    def unavailable(*args, **kwargs):
        raise PhotoGuardUnavailable("timeout")

    monkeypatch.setattr(photo_precheck, "classify_building_photo", unavailable)

    photo_precheck.run_stored_photo_precheck(db, photo)

    assert photo.precheck_status == "error"
    assert "原图已保留" in photo.precheck_error
    assert photo.storage_object_key == "projects/one/facade.jpg"
    assert db.commit_count == 2
