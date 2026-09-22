from __future__ import annotations

from io import BytesIO

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.tables import Photo
from app.services.object_storage import get_object_bytes
from app.services.photo_metadata import extract_formal_photo_metadata

METADATA_FIELDS = {
    "camera_make": "camera_make",
    "camera_model": "camera_model",
    "camera_product_name": "camera_product_name",
    "drone_model": "drone_model",
    "camera_image_source": "xmp_drone_dji_image_source",
    "longitude": "longitude",
    "latitude": "latitude",
    "absolute_altitude": "absolute_altitude",
    "relative_altitude": "relative_altitude",
    "gimbal_yaw_degree": "gimbal_yaw_degree",
    "gimbal_pitch_degree": "gimbal_pitch_degree",
    "gimbal_roll_degree": "gimbal_roll_degree",
    "calibrated_focal_length": "calibrated_focal_length",
    "focal_length_mm": "focal_length_mm",
    "focal_length_35mm": "focal_length_35mm",
    "lrf_target_distance": "lrf_target_distance",
}


def main() -> None:
    completed = 0
    skipped = 0
    unavailable = 0
    failed = 0
    with SessionLocal() as db:
        photos = list(db.scalars(select(Photo).where(Photo.deleted_at.is_(None))))
        for photo in photos:
            if all(getattr(photo, field) is not None for field in METADATA_FIELDS):
                skipped += 1
                continue
            try:
                data = get_object_bytes(photo.storage_bucket, photo.storage_object_key)
                metadata = extract_formal_photo_metadata(BytesIO(data))
                updated = False
                for field, metadata_key in METADATA_FIELDS.items():
                    value = metadata[metadata_key]
                    if value is not None and getattr(photo, field) != value:
                        setattr(photo, field, value)
                        updated = True
                if updated:
                    db.commit()
                    completed += 1
                else:
                    unavailable += 1
            except Exception as exc:
                db.rollback()
                failed += 1
                print(f"Photo pose backfill failed: {photo.id} ({type(exc).__name__})")

    print(
        "Photo pose backfill complete: "
        f"completed={completed}, skipped={skipped}, unavailable={unavailable}, failed={failed}"
    )


if __name__ == "__main__":
    main()
