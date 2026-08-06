from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from minio.error import S3Error

from app.services.object_storage import presigned_get_url, verify_object_access

router = APIRouter(tags=["object-storage"])


@router.get("/object-storage/{bucket}/{object_key:path}")
def get_signed_object(
    bucket: str,
    object_key: str,
    expires: int = Query(...),
    signature: str = Query(...),
) -> RedirectResponse:
    if not verify_object_access(bucket, object_key, expires, signature):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid or expired object URL.")

    try:
        direct_url = presigned_get_url(bucket, object_key)
    except S3Error as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Object storage request failed.") from exc
    if direct_url is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Object not found.")

    max_age = max(0, min(3600, expires - int(time.time())))
    return RedirectResponse(
        url=direct_url,
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
        headers={"Cache-Control": f"private, max-age={max_age}"},
    )
