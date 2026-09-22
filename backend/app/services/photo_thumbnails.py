from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from posixpath import splitext
from typing import BinaryIO

from PIL import Image, ImageOps, UnidentifiedImageError

from app.services.object_storage import get_object_bytes, put_object


THUMBNAIL_MAX_EDGE = 480
THUMBNAIL_WEBP_QUALITY = 60


@dataclass(frozen=True, slots=True)
class ThumbnailArtifact:
    content: bytes
    object_key: str
    source_width: int
    source_height: int


def thumbnail_object_key(original_object_key: str) -> str:
    stem, _ = splitext(original_object_key)
    return f"{stem}.thumb.webp"


def build_thumbnail(
    source: BinaryIO,
    original_object_key: str,
) -> ThumbnailArtifact | None:
    """Build a small list/grid thumbnail while preserving the input position.

    Invalid or unsupported images remain uploadable so the existing photo
    precheck can return the user-facing validation result. They simply do not
    receive a thumbnail and will render with the folder placeholder in lists.
    """

    position = source.tell()
    try:
        source.seek(0)
        with Image.open(source) as opened:
            opened.draft("RGB", (THUMBNAIL_MAX_EDGE * 2, THUMBNAIL_MAX_EDGE * 2))
            image = ImageOps.exif_transpose(opened)
            source_width, source_height = image.size
            if image.mode != "RGB":
                if "A" in image.getbands():
                    background = Image.new("RGB", image.size, "white")
                    background.paste(image, mask=image.getchannel("A"))
                    image = background
                else:
                    image = image.convert("RGB")
            image.thumbnail(
                (THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE),
                Image.Resampling.LANCZOS,
            )
            output = BytesIO()
            image.save(
                output,
                format="WEBP",
                quality=THUMBNAIL_WEBP_QUALITY,
                method=4,
            )
    except (AttributeError, OSError, TypeError, UnidentifiedImageError):
        return None
    finally:
        source.seek(position)

    return ThumbnailArtifact(
        content=output.getvalue(),
        object_key=thumbnail_object_key(original_object_key),
        source_width=source_width,
        source_height=source_height,
    )


def store_thumbnail(artifact: ThumbnailArtifact) -> str:
    return put_object(
        object_key=artifact.object_key,
        data=BytesIO(artifact.content),
        length=len(artifact.content),
        content_type="image/webp",
    )


def backfill_stored_thumbnail(
    storage_bucket: str,
    storage_object_key: str,
) -> ThumbnailArtifact | None:
    original = get_object_bytes(storage_bucket, storage_object_key)
    artifact = build_thumbnail(BytesIO(original), storage_object_key)
    if artifact is not None:
        store_thumbnail(artifact)
    return artifact
