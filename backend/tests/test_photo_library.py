from datetime import UTC, datetime
from io import BytesIO
from uuid import uuid4
from zipfile import ZipFile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.dependencies import AuthenticatedUser, get_current_user
from app.db.session import get_db
from app.main import app
from app.models.tables import AiDetectionResult, DetectionTask, Photo, PhotoLibraryClassification, Project, QuickDetectionPhoto, ReviewResult, TrialDetectionResult, UploadBatch, UserAccount


@compiles(JSONB, "sqlite")
def compile_jsonb_for_sqlite(type_, compiler, **kwargs):
    return "JSON"


@pytest.fixture
def library(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    tables = [model.__table__ for model in (UserAccount, Project, UploadBatch, DetectionTask, Photo, AiDetectionResult, ReviewResult, TrialDetectionResult, QuickDetectionPhoto, PhotoLibraryClassification)]
    UserAccount.metadata.create_all(engine, tables=tables)
    db = Session(engine)
    owner = UserAccount(id=uuid4(), username="library-owner", password_hash="test", role="customer")
    stranger = UserAccount(id=uuid4(), username="library-stranger", password_hash="test", role="customer")
    db.add_all([owner, stranger])
    db.flush()

    def project(name, creator, facade="tile", **kwargs):
        item = Project(id=uuid4(), project_no=f"PRJ-{uuid4().hex[:8]}", name=name, created_by=creator.id,
                       facade_type=facade, status="completed", **kwargs)
        db.add(item)
        db.flush()
        task = DetectionTask(id=uuid4(), project_id=item.id, task_no=f"TASK-{uuid4().hex}", created_by=creator.id, status="success")
        db.add(task)
        db.flush()
        item.current_task_id = task.id
        batch = UploadBatch(id=uuid4(), project_id=item.id, batch_no=f"UP-{uuid4().hex}", upload_mode="visible", uploaded_by=creator.id)
        db.add(batch)
        db.flush()
        return item, batch

    def photo(project_batch, name="DJI_0001.jpg", status="detected", **kwargs):
        item, batch = project_batch
        image = Photo(id=uuid4(), project_id=item.id, upload_batch_id=batch.id, original_filename=name,
                      storage_bucket="photos", storage_object_key=f"{uuid4()}.jpg", thumbnail_object_key=f"{uuid4()}.webp",
                      file_size=12, photo_type="visible", status=status, created_at=datetime(2026, 10, 7, 6, tzinfo=UTC), **kwargs)
        db.add(image)
        db.flush()
        return image

    def defect(image, item, kind, review=None):
        result = AiDetectionResult(id=uuid4(), project_id=item.id, photo_id=image.id, detection_task_id=item.current_task_id,
                                   defect_type=kind, bbox_json={"x": 1, "y": 2, "width": 3, "height": 4})
        db.add(result)
        db.flush()
        if review:
            replacement = ReviewResult(id=uuid4(), project_id=item.id, photo_id=image.id, detection_task_id=item.current_task_id,
                                       ai_result_id=result.id, defect_type=review[0], status=review[1], bbox_json={}, reviewer_id=owner.id)
            db.add(replacement)
        return result

    owned = project("测试楼宇", owner)
    foreign = project("其他客户楼宇", stranger, "coating")
    example = project("示例楼宇", stranger, "curtain_wall", is_example=True)
    hidden = project("已删除项目", owner, deleted_at=datetime.now(UTC))
    affected = photo(owned)
    clear = photo(owned)
    pending = photo(owned, "pending.jpg", "uploaded")
    failed = photo(owned, "failed.jpg", "failed")
    private = photo(foreign)
    public = photo(example)
    deleted_photo = photo(owned, deleted_at=datetime.now(UTC))
    photo(hidden)
    defect(affected, owned[0], "crack", ("spalling", "modified"))
    defect(affected, owned[0], "hollow", ("hollow", "deleted"))
    defect(affected, owned[0], "peeling")
    db.add(ReviewResult(id=uuid4(), project_id=owned[0].id, photo_id=affected.id, detection_task_id=owned[0].current_task_id,
                        defect_type="damage", status="added", bbox_json={}, reviewer_id=owner.id))
    historical = defect(clear, owned[0], "crack")
    historical.detection_task_id = foreign[0].current_task_id
    db.commit()
    viewer = AuthenticatedUser(owner.id, owner.username, None, "customer", None)
    app.dependency_overrides[get_current_user] = lambda: viewer
    app.dependency_overrides[get_db] = lambda: db
    reads = []

    def read_object(bucket, key):
        reads.append((bucket, key))
        return b"photo-bytes"

    monkeypatch.setattr("app.api.photo_library.get_object_bytes", read_object)
    client = TestClient(app)
    yield {
        "client": client, "db": db, "viewer": viewer, "reads": reads,
        "owned": owned, "affected": affected, "clear": clear, "pending": pending, "failed": failed,
        "private": private, "public": public, "deleted": deleted_photo, "add_photo": photo,
    }
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_db, None)
    client.close()
    db.close()
    engine.dispose()


def test_library_enforces_ownership_and_soft_deletion(library):
    response = library["client"].get("/api/photos/library")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["total"] == 5
    assert data["summary"] == {"total": 5, "defects": 1, "clear": 2, "pending": 1, "failed": 1}
    ids = {item["id"] for item in data["items"]}
    assert str(library["private"].id) not in ids
    assert str(library["deleted"].id) not in ids
    assert str(library["public"].id) in ids
    assert {project["name"] for project in data["projects"]} == {"测试楼宇", "示例楼宇"}
    assert all("signature=" in item["thumbnail_url"] for item in data["items"])
    selection = library["client"].get("/api/photos/library", params={"selection_only": "true"}).json()
    assert set(selection["photo_ids"]) == ids
    assert library["client"].get("/api/photos/library", params={
        "project_id": str(library["private"].project_id),
    }).json()["total"] == 0


def test_library_uses_reviewed_defects_and_current_task(library):
    client = library["client"]
    response = client.get("/api/photos/library", params={"result": "defects"})
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["defect_counts"] == {"spalling": 1, "peeling": 1, "damage": 1}
    assert client.get("/api/photos/library?defect_type=crack").json()["total"] == 0
    assert client.get("/api/photos/library?defect_type=hollow").json()["total"] == 0
    assert client.get("/api/photos/library?defect_type=spalling&facade_type=tile").json()["total"] == 1
    assert client.get("/api/photos/library?defect_type=spalling&facade_type=coating").json()["total"] == 0
    assert client.get("/api/photos/library?result=clear").json()["total"] == 2
    assert client.get("/api/photos/library?result=pending").json()["total"] == 1


def test_library_search_pagination_and_dates(library):
    client = library["client"]
    photo = library["add_photo"](library["owned"], "unique_100%.jpg")
    photo.created_at = datetime(2026, 10, 8, 6, tzinfo=UTC)
    library["db"].commit()
    assert client.get("/api/photos/library?search=unique_100%25").json()["total"] == 1
    assert client.get("/api/photos/library?search=100X").json()["total"] == 0
    assert client.get("/api/photos/library?search=测试楼宇").json()["total"] == 5
    first = client.get("/api/photos/library?page_size=2&sort=newest").json()
    second = client.get("/api/photos/library?page_size=2&page=2&sort=newest").json()
    assert first["items"][0]["id"] == str(photo.id)
    assert not ({item["id"] for item in first["items"]} & {item["id"] for item in second["items"]})
    assert client.get("/api/photos/library?page_size=2&page=999").json()["page"] == 3
    assert client.get("/api/photos/library?date_from=2026-10-08&date_to=2026-10-08").json()["total"] == 1
    assert client.get("/api/photos/library?date_from=2026-10-09&date_to=2026-10-08").status_code == 422


@pytest.mark.parametrize("role", ["admin", "reviewer"])
def test_internal_roles_can_browse_all_active_projects(library, role):
    viewer = library["viewer"]
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(viewer.id, viewer.username, None, role, None)
    data = library["client"].get("/api/photos/library").json()
    assert data["total"] == 6
    assert str(library["private"].id) in {item["id"] for item in data["items"]}
    assert {project["name"] for project in data["projects"]} == {"测试楼宇", "示例楼宇", "其他客户楼宇"}
    selection = library["client"].get("/api/photos/library", params={"selection_only": "true"}).json()
    assert selection["total"] == 6
    assert set(selection["photo_ids"]) == {item["id"] for item in data["items"]}
    foreign = library["client"].get("/api/photos/library", params={
        "project_id": str(library["private"].project_id),
    }).json()
    assert [item["id"] for item in foreign["items"]] == [str(library["private"].id)]
    response = library["client"].post("/api/photos/export", json={"photo_ids": selection["photo_ids"]})
    assert response.status_code == 200, response.text
    with ZipFile(BytesIO(response.content)) as archive:
        originals = [name for name in archive.namelist() if name.endswith(".jpg")]
        assert len(originals) == 6
        assert all(archive.read(name) == b"photo-bytes" for name in originals)
        assert any("其他客户楼宇" in name for name in originals)


def test_export_preserves_originals_and_writes_reviewed_manifest(library):
    library["owned"][0].name = "=SUM(1,2)/测试楼宇"
    library["affected"].original_filename = "../../same.jpg"
    library["clear"].original_filename = "../../same.jpg"
    library["db"].commit()
    ids = [str(library["affected"].id), str(library["clear"].id)]
    response = library["client"].post("/api/photos/export", json={"photo_ids": ids + ids})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    with ZipFile(BytesIO(response.content)) as archive:
        paths = archive.namelist()
        originals = [path for path in paths if path.endswith(".jpg")]
        assert len(originals) == 2 and len(set(originals)) == 2
        assert all(".." not in path.split("/") for path in paths)
        assert all(archive.read(path) == b"photo-bytes" for path in originals)
        assert any(path.startswith("饰面砖/检出缺陷/") for path in originals)
        assert any(path.startswith("饰面砖/未检出缺陷/") for path in originals)
        import json
        manifest = json.loads(archive.read("检测结果.json"))
        affected = next(item for item in manifest if item["photo_id"] == ids[0])
        assert affected["defect_counts"] == {"spalling": 1, "peeling": 1, "damage": 1}
        csv_content = archive.read("照片清单.csv").decode("utf-8-sig")
        assert "'=SUM(1,2)/测试楼宇" in csv_content
    assert len(library["reads"]) == 2


@pytest.mark.parametrize("bad_id", ["private", "deleted", "missing"])
def test_export_checks_every_photo_before_reading_storage(library, bad_id):
    invalid = uuid4() if bad_id == "missing" else library[bad_id].id
    response = library["client"].post("/api/photos/export", json={"photo_ids": [str(library["affected"].id), str(invalid)]})
    assert response.status_code == 404
    assert library["reads"] == []


def test_export_allows_more_than_200_photos_and_512mb(library):
    photos = [library["add_photo"](library["owned"], f"photo-{index}.jpg") for index in range(201)]
    for photo in photos:
        photo.file_size = 3 * 1024 * 1024
    library["db"].commit()
    response = library["client"].post("/api/photos/export", json={"photo_ids": [str(photo.id) for photo in photos]})
    assert response.status_code == 200, response.text
    with ZipFile(BytesIO(response.content)) as archive:
        originals = [name for name in archive.namelist() if name.endswith(".jpg")]
        assert len(originals) == 201
        assert all(archive.read(name) == b"photo-bytes" for name in originals)
    selection = library["client"].get("/api/photos/library", params={
        "project_id": str(library["owned"][0].id), "selection_only": "true",
    }).json()
    assert selection["total"] == 205
    assert len(selection["photo_ids"]) == 205
    assert {str(photo.id) for photo in photos}.issubset(selection["photo_ids"])
    assert str(library["private"].id) not in selection["photo_ids"]


def test_export_empty_selection_and_storage_failure(library, monkeypatch):
    photo = library["affected"]
    ids = {"photo_ids": [str(photo.id)]}
    assert library["client"].post("/api/photos/export", json={"photo_ids": []}).status_code == 422

    def fail_read(*args):
        raise OSError("storage unavailable")

    monkeypatch.setattr("app.api.photo_library.get_object_bytes", fail_read)
    response = library["client"].post("/api/photos/export", json=ids)
    assert response.status_code == 502
    assert "打包失败" in response.json()["message"]


def test_library_and_export_require_authentication(library):
    app.dependency_overrides.pop(get_current_user)
    assert library["client"].get("/api/photos/library").status_code == 401
    assert library["client"].post("/api/photos/export", json={"photo_ids": [str(library["affected"].id)]}).status_code == 401
    assert library["client"].patch("/api/photos/facade-type", json={"photo_ids": [str(library["affected"].id)], "facade_type": "stone"}).status_code == 401


def test_photo_classification_is_independent_and_used_by_filters_and_export(library):
    client, db = library["client"], library["db"]
    selected_id = str(library["affected"].id)
    response = client.patch("/api/photos/facade-type", json={"photo_ids": [selected_id, selected_id], "facade_type": "stone"})
    assert response.status_code == 200, response.text
    assert response.json() == {"updated_count": 1, "facade_type": "stone"}
    db.expire_all()
    assert library["owned"][0].facade_type == "tile"
    stone = client.get("/api/photos/library?facade_type=stone").json()
    assert [item["id"] for item in stone["items"]] == [selected_id]
    assert stone["items"][0]["facade_type"] == "stone"
    assert stone["summary"]["defects"] == 1
    tile = client.get("/api/photos/library?facade_type=tile").json()
    assert tile["total"] == 3
    assert selected_id not in {item["id"] for item in tile["items"]}
    assert client.get("/api/photos/library?facade_type=stone&selection_only=true").json()["photo_ids"] == [selected_id]
    exported = client.post("/api/photos/export", json={"photo_ids": [selected_id]})
    assert exported.status_code == 200
    with ZipFile(BytesIO(exported.content)) as archive:
        assert next(name for name in archive.namelist() if name.endswith(".jpg")).startswith("石材/")
        import json
        assert json.loads(archive.read("检测结果.json"))[0]["facade_type"] == "stone"
        assert "石材" in archive.read("照片清单.csv").decode("utf-8-sig")
    response = client.patch("/api/photos/facade-type", json={"photo_ids": [selected_id], "facade_type": "coating"})
    assert response.status_code == 200, response.text
    assert client.get("/api/photos/library?facade_type=stone").json()["total"] == 0
    assert client.get("/api/photos/library?facade_type=coating").json()["total"] == 1
    assert db.get(PhotoLibraryClassification, library["affected"].id).updated_by == library["viewer"].id


@pytest.mark.parametrize("bad_id,status", [("private", 404), ("deleted", 404), ("missing", 404), ("public", 403)])
def test_classification_validates_entire_batch_before_writing(library, bad_id, status):
    invalid = uuid4() if bad_id == "missing" else library[bad_id].id
    response = library["client"].patch("/api/photos/facade-type", json={
        "photo_ids": [str(library["affected"].id), str(invalid)], "facade_type": "stone",
    })
    assert response.status_code == status, response.text
    assert library["db"].query(PhotoLibraryClassification).count() == 0
    assert library["owned"][0].facade_type == "tile"


def test_admin_can_classify_foreign_photos_and_batches_over_200(library):
    viewer = library["viewer"]
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(viewer.id, viewer.username, None, "admin", None)
    new_photos = [library["add_photo"](library["owned"], f"bulk-{index}.jpg") for index in range(201)]
    library["db"].commit()
    ids = [str(photo.id) for photo in new_photos] + [str(library["private"].id)]
    response = library["client"].patch("/api/photos/facade-type", json={"photo_ids": ids, "facade_type": "plaster"})
    assert response.status_code == 200, response.text
    assert response.json()["updated_count"] == 202
    assert library["client"].get("/api/photos/library?facade_type=plaster&selection_only=true").json()["total"] == 202
    assert library["db"].get(Project, library["private"].project_id).facade_type == "coating"


def test_classification_rejects_invalid_payloads(library):
    client = library["client"]
    assert client.patch("/api/photos/facade-type", json={"photo_ids": [], "facade_type": "stone"}).status_code == 422
    assert client.patch("/api/photos/facade-type", json={"photo_ids": [str(library["affected"].id)], "facade_type": "unknown"}).status_code == 422
    assert library["db"].query(PhotoLibraryClassification).count() == 0

@pytest.mark.parametrize("role", ["customer", "admin"])
def test_library_filters_and_exports_quick_experience_photos(library, role):
    db, viewer = library["db"], library["viewer"]
    stranger_id = db.get(Project, library["private"].project_id).created_by
    own_id, foreign_id, hidden_id = uuid4(), uuid4(), uuid4()
    own_result = TrialDetectionResult(
        id=uuid4(), result_no="TRIAL-OWN", title="自己的快速体验", generated_by=viewer.id,
        report_data_json={"photos": [{"id": str(own_id), "original_filename": "own-thermal.jpg", "file_size": 12,
            "thermal_imaging_available": True, "storage_bucket": "photos", "storage_object_key": "own.jpg"}],
            "defects": [{"photo_id": str(own_id), "defect_type": "hollow", "status": "generated"}]},
    )
    foreign_result = TrialDetectionResult(
        id=uuid4(), result_no="TRIAL-FOREIGN", title="其他账号的快速体验", generated_by=stranger_id,
        report_data_json={"photos": [{"id": str(foreign_id), "original_filename": "foreign.jpg",
            "storage_bucket": "photos", "storage_object_key": "foreign.jpg"}]},
    )
    hidden_result = TrialDetectionResult(
        id=uuid4(), result_no="TRIAL-HIDDEN", title="已删除快速体验", generated_by=viewer.id,
        deleted_at=datetime.now(UTC), report_data_json={"photos": [{"id": str(hidden_id), "original_filename": "hidden.jpg",
            "storage_bucket": "photos", "storage_object_key": "hidden.jpg"}]},
    )
    db.add_all([own_result, foreign_result, hidden_result])
    db.flush()
    # The current upload and archived snapshot represent the same original.
    db.add(QuickDetectionPhoto(id=own_id, original_filename="own-thermal.jpg", file_size=12,
        storage_bucket="photos", storage_object_key="own.jpg", metadata_json={},
        thermal_imaging_available=True, uploaded_by=viewer.id, generated_result_id=own_result.id,
        created_at=datetime(2026, 10, 8, 6, tzinfo=UTC)))
    db.add(QuickDetectionPhoto(id=hidden_id, original_filename="hidden.jpg", file_size=12,
        storage_bucket="photos", storage_object_key="hidden.jpg", metadata_json={},
        uploaded_by=viewer.id, generated_result_id=hidden_result.id))
    pending_id = uuid4()
    db.add(QuickDetectionPhoto(id=pending_id, original_filename="pending-trial.jpg", file_size=12,
        storage_bucket="photos", storage_object_key="pending-trial.jpg", metadata_json={}, uploaded_by=viewer.id))
    db.commit()
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(viewer.id, viewer.username, None, role, None)
    client = library["client"]
    all_data = client.get("/api/photos/library").json()
    assert all_data["total"] == (9 if role == "admin" else 7)
    professional = client.get("/api/photos/library?source_type=professional").json()
    assert professional["total"] == (6 if role == "admin" else 5)
    trials = client.get("/api/photos/library?source_type=trial").json()
    expected = {str(own_id), str(pending_id)} | ({str(foreign_id)} if role == "admin" else set())
    assert {photo["id"] for photo in trials["items"]} == expected
    assert str(hidden_id) not in expected
    assert all(photo["source_type"] == "trial" and photo["facade_type"] is None for photo in trials["items"])
    assert client.get("/api/photos/library?source_type=trial&photo_type=thermal&defect_type=hollow&result=defects").json()["total"] == 1
    assert client.get("/api/photos/library?source_type=trial&facade_type=tile").json()["total"] == 0
    assert client.get("/api/photos/library?source_type=trial&search=own-thermal").json()["total"] == 1
    dated = client.get("/api/photos/library?source_type=trial&date_from=2026-10-08&date_to=2026-10-08").json()
    assert [item["id"] for item in dated["items"]] == [str(own_id)]
    dated_selection = client.get("/api/photos/library?source_type=trial&date_from=2026-10-08&date_to=2026-10-08&selection_only=true").json()
    assert dated_selection["photo_ids"] == [str(own_id)]
    assert client.get("/api/photos/library", params={"source_type": "trial", "project_id": str(own_result.id)}).json()["total"] == 1
    pages = [client.get("/api/photos/library", params={"page_size": 2, "page": page, "sort": sort}).json()
        for sort in ["newest", "oldest", "filename"] for page in range(1, (all_data["total"] + 1) // 2 + 1)]
    for sort_index in range(3):
        group_size = (all_data["total"] + 1) // 2
        ids = [item["id"] for page in pages[sort_index * group_size:(sort_index + 1) * group_size] for item in page["items"]]
        assert len(ids) == len(set(ids)) == all_data["total"]
    selection = client.get("/api/photos/library?source_type=trial&selection_only=true").json()
    assert set(selection["photo_ids"]) == expected
    response = client.post("/api/photos/export", json={"photo_ids": selection["photo_ids"]})
    assert response.status_code == 200, response.text
    with ZipFile(BytesIO(response.content)) as archive:
        originals = [name for name in archive.namelist() if name.endswith(".jpg")]
        assert len(originals) == len(expected)
        assert all(archive.read(name) == b"photo-bytes" for name in originals)
        import json
        manifest = json.loads(archive.read("检测结果.json"))
        assert all(item["source_type"] == "trial" for item in manifest)
        assert next(item for item in manifest if item["photo_id"] == str(own_id))["defect_counts"] == {"hollow": 1}
    if role == "customer":
        library["reads"].clear()
        assert client.post("/api/photos/export", json={"photo_ids": [str(foreign_id)]}).status_code == 404
        assert library["reads"] == []
    # Both current uploads and JSON-only archives use photo labels without
    # rewriting the saved report or the professional project's material.
    from copy import deepcopy
    archive_before = deepcopy(own_result.report_data_json)
    ids = [str(own_id), str(pending_id), str(library["affected"].id)]
    response = client.patch("/api/photos/facade-type", json={"photo_ids": ids, "facade_type": "stone"})
    assert response.status_code == 200, response.text
    assert response.json()["updated_count"] == 3
    db.expire_all()
    assert own_result.report_data_json == archive_before
    assert library["owned"][0].facade_type == "tile"
    classified = client.get("/api/photos/library?source_type=trial&facade_type=stone").json()
    assert {item["id"] for item in classified["items"]} == {str(own_id), str(pending_id)}
    assert client.get("/api/photos/library?facade_type=stone&selection_only=true").json()["total"] == 3
    if role == "admin":
        assert client.patch("/api/photos/facade-type", json={"photo_ids": [str(foreign_id)], "facade_type": "panel"}).status_code == 200
        assert client.get("/api/photos/library?source_type=trial&facade_type=panel").json()["items"][0]["id"] == str(foreign_id)
