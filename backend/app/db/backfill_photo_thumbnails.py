from __future__ import annotations

from copy import deepcopy

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.tables import InspectionReport, Photo, QuickDetectionPhoto, TrialDetectionResult
from app.services.photo_thumbnails import backfill_stored_thumbnail


def _backfill_model(db, model) -> tuple[int, int]:
    completed = 0
    failed = 0
    rows = list(
        db.scalars(
            select(model).where(model.thumbnail_object_key.is_(None))
        )
    )
    for photo in rows:
        try:
            artifact = backfill_stored_thumbnail(
                photo.storage_bucket,
                photo.storage_object_key,
            )
            if artifact is None:
                failed += 1
                continue
            photo.thumbnail_object_key = artifact.object_key
            if isinstance(photo, Photo):
                photo.image_width = artifact.source_width
                photo.image_height = artifact.source_height
            db.commit()
            completed += 1
        except Exception as exc:
            db.rollback()
            failed += 1
            print(
                "Thumbnail backfill failed: "
                f"{model.__tablename__} {photo.id} ({type(exc).__name__})"
            )
    return completed, failed


def _thumbnail_maps(db) -> tuple[dict[str, str], dict[tuple[str, str], str]]:
    by_id: dict[str, str] = {}
    by_storage: dict[tuple[str, str], str] = {}
    for model in (Photo, QuickDetectionPhoto):
        for photo in db.scalars(
            select(model).where(model.thumbnail_object_key.is_not(None))
        ):
            by_id[str(photo.id)] = photo.thumbnail_object_key
            by_storage[(photo.storage_bucket, photo.storage_object_key)] = photo.thumbnail_object_key
    return by_id, by_storage


def _with_thumbnail_keys(
    data: dict,
    by_id: dict[str, str],
    by_storage: dict[tuple[str, str], str],
) -> tuple[dict, bool]:
    updated = deepcopy(data)
    changed = False
    photos = updated.get("photos") or []
    if not isinstance(photos, list):
        return updated, False
    for photo in photos:
        if not isinstance(photo, dict):
            continue
        thumbnail_key = by_id.get(str(photo.get("id")))
        if thumbnail_key is None:
            storage_bucket = photo.get("storage_bucket")
            storage_object_key = photo.get("storage_object_key")
            if storage_bucket and storage_object_key:
                thumbnail_key = by_storage.get((storage_bucket, storage_object_key))
        if thumbnail_key and photo.get("thumbnail_object_key") != thumbnail_key:
            photo["thumbnail_object_key"] = thumbnail_key
            changed = True
    return updated, changed


def _backfill_report_snapshots(db) -> int:
    by_id, by_storage = _thumbnail_maps(db)
    updated_count = 0
    for model in (InspectionReport, TrialDetectionResult):
        for report in db.scalars(select(model)):
            data = report.report_data_json or {}
            updated, changed = _with_thumbnail_keys(data, by_id, by_storage)
            if changed:
                report.report_data_json = updated
                updated_count += 1
    db.commit()
    return updated_count


def main() -> None:
    with SessionLocal() as db:
        formal_completed, formal_failed = _backfill_model(db, Photo)
        trial_completed, trial_failed = _backfill_model(db, QuickDetectionPhoto)
        report_updates = _backfill_report_snapshots(db)

    print(
        "Thumbnail backfill complete: "
        f"formal={formal_completed}, trial={trial_completed}, "
        f"failed={formal_failed + trial_failed}, report_snapshots={report_updates}"
    )


if __name__ == "__main__":
    main()
