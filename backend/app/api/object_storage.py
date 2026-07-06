from __future__ import annotations

from mimetypes import guess_type

from fastapi import APIRouter, HTTPException, Query, Response, status
from minio.error import S3Error

from app.services.object_storage import get_object_bytes, verify_object_access

router = APIRouter(tags=["object-storage"])


@router.get("/object-storage/{bucket}/{object_key:path}")
def get_signed_object(
    bucket: str,
    object_key: str,
    expires: int = Query(...),
    signature: str = Query(...),
) -> Response:
    if not verify_object_access(bucket, object_key, expires, signature):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid or expired object URL.")

    try:
        content = get_object_bytes(bucket, object_key)
    except S3Error as exc:
        if exc.code == "NoSuchKey":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Object not found.") from exc
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Object storage request failed.") from exc

    content_type = guess_type(object_key)[0] or "application/octet-stream"
    return Response(
        content=content,
        media_type=content_type,
        headers={"Cache-Control": "private, max-age=300"},
    )
