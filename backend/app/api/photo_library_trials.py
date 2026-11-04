"""Adapt stored quick-experience photos to the shared photo library."""
from collections import Counter
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedUser
from app.models.tables import PhotoLibraryClassification, QuickDetectionPhoto, TrialDetectionResult
from app.schemas.photo_library import LibraryPhotoRead
from app.services.object_storage import signed_object_url


def trial_library_photos(
    db: Session, user: AuthenticatedUser, api_base_url: str, photo_ids: set[UUID] | None = None,
) -> list[tuple[LibraryPhotoRead, str, str]]:
    if photo_ids is not None and not photo_ids:
        return []
    results_query = select(TrialDetectionResult).where(TrialDetectionResult.deleted_at.is_(None))
    quick_query = select(QuickDetectionPhoto).outerjoin(
        TrialDetectionResult, TrialDetectionResult.id == QuickDetectionPhoto.generated_result_id,
    ).where(or_(QuickDetectionPhoto.generated_result_id.is_(None), TrialDetectionResult.deleted_at.is_(None)))
    if user.role == "customer":
        results_query = results_query.where(or_(TrialDetectionResult.generated_by == user.id, TrialDetectionResult.is_example.is_(True)))
        quick_query = quick_query.where(QuickDetectionPhoto.uploaded_by == user.id)
    if photo_ids is not None:
        quick_query = quick_query.where(QuickDetectionPhoto.id.in_(photo_ids))
    # New results reference quick-photo IDs; older results store their photos only
    # in the archive. Prefer the archive's detection results and deduplicate IDs.
    entries = {}
    for result in db.scalars(results_query.order_by(TrialDetectionResult.generated_at, TrialDetectionResult.id)):
        data = result.report_data_json or {}
        for photo in data.get("photos") or []:
            try:
                photo_id = UUID(str(photo.get("id")))
            except (ValueError, TypeError):
                continue
            if photo_ids is not None and photo_id not in photo_ids:
                continue
            counts = Counter(
                defect["defect_type"] for defect in data.get("defects") or []
                if str(defect.get("photo_id")) == str(photo_id) and defect.get("defect_type")
                and defect.get("status") != "deleted"
            )
            entries[photo_id] = (photo, result, counts, result.generated_at)
    for photo in db.scalars(quick_query):
        if photo.id in entries:
            snapshot, result, counts, _ = entries[photo.id]
            entries[photo.id] = (snapshot, result, counts, photo.created_at)
        else:
            # An attached result outside this user's scope must not leak results.
            entries[photo.id] = ({
                "id": str(photo.id), "original_filename": photo.original_filename,
                "file_size": photo.file_size, "metadata_json": photo.metadata_json,
                "thermal_imaging_available": photo.thermal_imaging_available,
                "storage_bucket": photo.storage_bucket, "storage_object_key": photo.storage_object_key,
                "thumbnail_object_key": photo.thumbnail_object_key,
            }, None, {}, photo.created_at)
    items = []
    classifications = dict(db.execute(select(PhotoLibraryClassification.photo_id, PhotoLibraryClassification.facade_type).where(
        PhotoLibraryClassification.photo_id.in_(entries),
    )).all()) if entries else {}
    for photo_id, (photo, result, counts, created_at) in entries.items():
        bucket, key = photo.get("storage_bucket"), photo.get("storage_object_key")
        if not bucket or not key:
            continue
        metadata = photo.get("metadata_json") or {}
        preview = signed_object_url(api_base_url, bucket, key)
        item = LibraryPhotoRead(
            id=photo_id, source_type="trial", project_id=result.id if result else None,
            project_name=result.title if result else "快速体验", project_no=result.result_no if result else "—",
            facade_type=classifications.get(photo_id), original_filename=photo.get("original_filename") or "未命名",
            file_size=photo.get("file_size"), image_width=metadata.get("image_width"), image_height=metadata.get("image_height"),
            photo_type="thermal" if photo.get("thermal_imaging_available") else "visible",
            status="detected" if result else "uploaded", result=("defects" if counts else "clear") if result else "pending",
            defect_counts=dict(counts), preview_url=preview,
            thumbnail_url=signed_object_url(api_base_url, bucket, photo.get("thumbnail_object_key")) or preview,
            created_at=created_at,
        )
        items.append((item, bucket, key))
    return items
