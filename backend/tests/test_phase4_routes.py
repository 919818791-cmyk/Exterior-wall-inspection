from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.api.dependencies import AuthenticatedUser
from app.api.photos import upload_photo
from app.enums.status import PhotoType, ProjectStatus, UploadMode, UserRole
from app.main import app
from app.models.tables import Photo, Project, UploadBatch, UsageEvent
from app.schemas.phase4 import DetectionConfigUpdateRequest, UploadBatchCreateRequest


class SizedUploadStream:
    def __init__(self, size: int) -> None:
        self.size = size
        self.position = 0

    def seek(self, offset: int, whence: int = 0) -> int:
        if whence == 0:
            self.position = offset
        elif whence == 1:
            self.position += offset
        elif whence == 2:
            self.position = self.size + offset
        return self.position

    def tell(self) -> int:
        return self.position


class FakePhotoUploadDb:
    def __init__(self, project: Project, batch: UploadBatch) -> None:
        self.project = project
        self.batch = batch
        self.photos: list[Photo] = []
        self.usage_events: list[UsageEvent] = []

    def get(self, model: type, item_id: object) -> object | None:
        if model is Project and item_id == self.project.id:
            return self.project
        if model is UploadBatch and item_id == self.batch.id:
            return self.batch
        return None

    def add(self, item: object) -> None:
        if isinstance(item, Photo):
            now = datetime.now(UTC)
            if getattr(item, "id", None) is None:
                item.id = uuid4()
            item.created_at = now
            item.updated_at = now
            item.deleted_at = None
            self.photos.append(item)
        elif isinstance(item, UsageEvent):
            self.usage_events.append(item)

    def flush(self) -> None:
        return None

    def scalars(self, _: object) -> list[Photo]:
        return self.photos

    def commit(self) -> None:
        return None

    def refresh(self, _: object) -> None:
        return None


def test_phase4_routes_are_registered() -> None:
    paths = {route.path for route in app.routes}

    assert "/api/projects/{project_id}/upload-batches" in paths
    assert "/api/photos/upload" in paths
    assert "/api/projects/{project_id}/photos" in paths
    assert "/api/photos/{photo_id}" in paths
    assert "/api/photos/{photo_id}/precheck" not in paths
    assert "/api/projects/{project_id}/detection-config" in paths


def test_detection_config_requires_at_least_one_model() -> None:
    assert DetectionConfigUpdateRequest.model_fields["model_types"].metadata


def test_upload_batch_has_no_building_dimension() -> None:
    assert "building_id" not in UploadBatchCreateRequest.model_fields


def test_photo_upload_accepts_large_files_without_size_limit(monkeypatch) -> None:
    monkeypatch.setattr("app.api.photos.put_object", lambda **_: "test-bucket")
    monkeypatch.setattr("app.api.photos.presigned_get_url", lambda bucket, key: f"https://storage.local/{key}" if key else None)

    owner_id = uuid4()
    project = Project(
        id=uuid4(),
        project_no="PRJ-UPLOAD-LIMIT",
        name="上传限制项目",
        status=ProjectStatus.DRAFT.value,
        created_by=owner_id,
    )
    batch = UploadBatch(
        id=uuid4(),
        project_id=project.id,
        batch_no="UP-UPLOAD-LIMIT",
        upload_mode=UploadMode.VISIBLE.value,
        photo_count=0,
        uploaded_by=owner_id,
    )
    file = SimpleNamespace(
        file=SizedUploadStream(150 * 1024 * 1024),
        filename="large.jpg",
        content_type="image/jpeg",
    )
    current_user = AuthenticatedUser(
        id=owner_id,
        username="admin",
        real_name="平台管理员",
        role=UserRole.ADMIN.value,
        organization=None,
    )

    fake_db = FakePhotoUploadDb(project, batch)
    uploaded = upload_photo(
        project_id=project.id,
        upload_batch_id=batch.id,
        photo_type=PhotoType.VISIBLE,
        file=file,
        db=fake_db,
        current_user=current_user,
    )

    assert uploaded.original_filename == "large.jpg"
    assert uploaded.file_size == 150 * 1024 * 1024
    assert len(fake_db.usage_events) == 1
    assert fake_db.usage_events[0].photo_count == 1
    assert fake_db.usage_events[0].storage_bytes == 150 * 1024 * 1024


def test_formal_photo_precheck_rejection_keeps_stored_original(monkeypatch) -> None:
    owner_id = uuid4()
    project = Project(
        id=uuid4(),
        project_no="PRJ-GUARD-REJECT",
        name="准入校验项目",
        status=ProjectStatus.DRAFT.value,
        created_by=owner_id,
    )
    batch = UploadBatch(
        id=uuid4(),
        project_id=project.id,
        batch_no="UP-GUARD-REJECT",
        upload_mode=UploadMode.VISIBLE.value,
        photo_count=0,
        uploaded_by=owner_id,
    )
    current_user = AuthenticatedUser(
        id=owner_id,
        username="admin",
        real_name="平台管理员",
        role=UserRole.ADMIN.value,
        organization=None,
    )
    file = SimpleNamespace(
        file=SizedUploadStream(1024),
        filename="cat.jpg",
        content_type="image/jpeg",
    )
    stored = False

    def put(**kwargs) -> str:
        nonlocal stored
        stored = True
        return "test-bucket"

    def reject_after_storage(db, photo) -> None:
        assert stored is True
        photo.precheck_status = "rejected"
        photo.precheck_category = "OTHER"
        photo.precheck_reason = "图片主体与建筑外墙无关"
        photo.precheck_model = "guard-test"
        photo.precheck_error = None
        photo.precheck_attempts = 1
        photo.prechecked_at = datetime.now(UTC)

    monkeypatch.setattr("app.api.photos.run_stored_photo_precheck", reject_after_storage)
    monkeypatch.setattr("app.api.photos.put_object", put)
    monkeypatch.setattr(
        "app.api.photos.presigned_get_url",
        lambda bucket, key: f"https://storage.local/{key}" if key else None,
    )

    fake_db = FakePhotoUploadDb(project, batch)
    uploaded = upload_photo(
        project_id=project.id,
        upload_batch_id=batch.id,
        photo_type=PhotoType.VISIBLE,
        file=file,
        db=fake_db,
        current_user=current_user,
    )

    assert stored is True
    assert uploaded.precheck_status == "rejected"
    assert len(fake_db.photos) == 1
