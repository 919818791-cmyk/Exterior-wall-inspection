from io import BytesIO

from PIL import Image

from app.services.photo_thumbnails import build_thumbnail


def test_build_thumbnail_creates_small_webp_and_preserves_stream_position() -> None:
    source = BytesIO()
    Image.new("RGB", (1600, 900), (40, 100, 160)).save(source, format="JPEG", quality=92)
    source.seek(7)

    thumbnail = build_thumbnail(source, "projects/example/photos/photo.jpg")

    assert thumbnail is not None
    assert thumbnail.object_key == "projects/example/photos/photo.thumb.webp"
    assert thumbnail.source_width == 1600
    assert thumbnail.source_height == 900
    assert source.tell() == 7
    with Image.open(BytesIO(thumbnail.content)) as image:
        assert image.format == "WEBP"
        assert max(image.size) == 480


def test_build_thumbnail_skips_invalid_images() -> None:
    source = BytesIO(b"not-an-image")

    assert build_thumbnail(source, "photos/file.bin") is None
    assert source.tell() == 0
