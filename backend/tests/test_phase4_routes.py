from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

from app.api.dependencies import AuthenticatedUser
from app.api.photos import upload_photo
from app.enums.status import PhotoType, ProjectStatus, UploadMode, UserRole
from app.main import app
from app.models.tables import Photo, Project, UploadBatch
from app.schemas.phase4 import DetectionConfigUpdateRequest


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
    assert "/api/projects/{project_id}/detection-config" in paths


def test_detection_config_requires_at_least_one_model() -> None:
    assert DetectionConfigUpdateRequest.model_fields["model_types"].metadata


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

    uploaded = upload_photo(
        project_id=project.id,
        upload_batch_id=batch.id,
        building_id=None,
        facade_id=None,
        photo_type=PhotoType.VISIBLE,
        file=file,
        db=FakePhotoUploadDb(project, batch),
        current_user=current_user,
    )

    assert uploaded.original_filename == "large.jpg"
    assert uploaded.file_size == 150 * 1024 * 1024
