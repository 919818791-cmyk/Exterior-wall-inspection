from app.api import reports


def test_report_list_falls_back_to_original_for_legacy_photo(monkeypatch) -> None:
    monkeypatch.setattr(
        reports,
        "_safe_photo_url",
        lambda _request, _bucket, object_key: f"signed:{object_key}" if object_key else None,
    )
    data = {
        "photos": [
            {
                "storage_bucket": "building-exterior",
                "storage_object_key": "photos/original.jpg",
                "thumbnail_object_key": None,
            }
        ]
    }

    assert reports._first_photo_url(data) == "signed:photos/original.jpg"


def test_report_list_uses_thumbnail_object(monkeypatch) -> None:
    monkeypatch.setattr(
        reports,
        "_safe_photo_url",
        lambda _request, _bucket, object_key: f"signed:{object_key}" if object_key else None,
    )
    data = {
        "photos": [
            {
                "storage_bucket": "building-exterior",
                "storage_object_key": "photos/original.jpg",
                "thumbnail_object_key": "photos/original.thumb.webp",
            }
        ]
    }

    assert reports._first_photo_url(data) == "signed:photos/original.thumb.webp"
