from datetime import UTC, datetime
from io import BytesIO
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.api.dependencies import AuthenticatedUser
from fastapi import HTTPException

from app.api.photos import FORMAL_MAX_FILE_SIZE_BYTES, upload_photo
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


def test_photo_upload_rejects_files_larger_than_five_megabytes(monkeypatch) -> None:
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
        file=SizedUploadStream(FORMAL_MAX_FILE_SIZE_BYTES + 1),
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
    with pytest.raises(HTTPException) as raised:
        upload_photo(
            project_id=project.id,
            upload_batch_id=batch.id,
            photo_type=PhotoType.VISIBLE,
            file=file,
            db=fake_db,
            current_user=current_user,
        )

    assert raised.value.status_code == 400
    assert raised.value.detail == "单张图片最大 10MB。"
    assert fake_db.usage_events == []


def test_photo_upload_rejects_more_than_thirty_photos_per_project() -> None:
    owner_id = uuid4()
    project = Project(
        id=uuid4(),
        project_no="PRJ-PHOTO-COUNT-LIMIT",
        name="照片数量限制项目",
        status=ProjectStatus.DRAFT.value,
        created_by=owner_id,
    )
    batch = UploadBatch(
        id=uuid4(),
        project_id=project.id,
        batch_no="UP-PHOTO-COUNT-LIMIT",
        upload_mode=UploadMode.VISIBLE.value,
        photo_count=30,
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
        filename="photo-031.jpg",
        content_type="image/jpeg",
    )
    fake_db = FakePhotoUploadDb(project, batch)
    fake_db.photos = [SimpleNamespace() for _ in range(30)]

    with pytest.raises(HTTPException) as raised:
        upload_photo(
            project_id=project.id,
            upload_batch_id=batch.id,
            photo_type=PhotoType.VISIBLE,
            file=file,
            db=fake_db,
            current_user=current_user,
        )

    assert raised.value.status_code == 400
    assert raised.value.detail == "每个项目最多上传 30 张照片。"
    assert fake_db.usage_events == []


def test_formal_non_drone_rejection_keeps_stored_original(monkeypatch) -> None:
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

    def fail_if_called(*_: object, **__: object) -> None:
        raise AssertionError("non-drone photos must not enter the building-photo precheck")

    monkeypatch.setattr("app.api.photos.run_stored_photo_precheck", fail_if_called)
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
    assert uploaded.precheck_category == "NON_DRONE"
    assert "无人机拍摄元数据" in (uploaded.precheck_reason or "")
    assert "无人机机型信息" in (uploaded.precheck_reason or "")
    assert len(fake_db.photos) == 1


def test_formal_drone_metadata_runs_building_precheck_and_records_model(monkeypatch) -> None:
    owner_id = uuid4()
    project = Project(
        id=uuid4(),
        project_no="PRJ-DRONE-METADATA",
        name="无人机照片项目",
        status=ProjectStatus.DRAFT.value,
        created_by=owner_id,
    )
    batch = UploadBatch(
        id=uuid4(),
        project_id=project.id,
        batch_no="UP-DRONE-METADATA",
        upload_mode=UploadMode.DJI.value,
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
    data = (
        b"\xff\xd8"
        b'<rdf:Description tiff:Make="DJI" tiff:Model="M3T" '
        b'drone-dji:RelativeAltitude="35.0" />'
        b"\xff\xd9"
    )
    file = SimpleNamespace(
        file=BytesIO(data),
        filename="DJI_0001.JPG",
        content_type="image/jpeg",
    )

    def pass_building_precheck(_: object, photo: Photo) -> None:
        photo.precheck_status = "passed"
        photo.precheck_category = "BUILDING"
        photo.precheck_reason = "建筑外立面照片"
        photo.precheck_model = "guard-test"
        photo.precheck_attempts = 1
        photo.prechecked_at = datetime.now(UTC)

    monkeypatch.setattr("app.api.photos.put_object", lambda **_: "test-bucket")
    monkeypatch.setattr("app.api.photos.run_stored_photo_precheck", pass_building_precheck)
    monkeypatch.setattr(
        "app.api.photos.presigned_get_url",
        lambda bucket, key: f"https://storage.local/{key}" if key else None,
    )

    uploaded = upload_photo(
        project_id=project.id,
        upload_batch_id=batch.id,
        photo_type=PhotoType.DJI,
        file=file,
        db=FakePhotoUploadDb(project, batch),
        current_user=current_user,
    )

    assert uploaded.precheck_status == "passed"
    assert batch.drone_type == "M3T"
