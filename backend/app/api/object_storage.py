from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from minio.error import S3Error
from starlette.background import BackgroundTask
from urllib3.exceptions import HTTPError

from app.services.object_storage import open_object, verify_object_access

router = APIRouter(tags=["object-storage"])


@router.get("/object-storage/{bucket}/{object_key:path}")
def get_signed_object(
    bucket: str,
    object_key: str,
    request: Request,
    expires: int = Query(...),
    signature: str = Query(...),
) -> StreamingResponse:
    if not verify_object_access(bucket, object_key, expires, signature):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid or expired object URL.")

    try:
        upstream = open_object(bucket, object_key, byte_range=request.headers.get("range"))
    except S3Error as exc:
        if exc.code in {"NoSuchKey", "NoSuchObject", "NoSuchBucket"}:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Object not found.") from exc
        if exc.code == "InvalidRange":
            raise HTTPException(status_code=status.HTTP_416_RANGE_NOT_SATISFIABLE, detail="Invalid object range.") from exc
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Object storage request failed.") from exc
    except HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Object storage is unavailable.") from exc

    released = False

    def close_upstream() -> None:
        nonlocal released
        if not released:
            released = True
            upstream.close()
            upstream.release_conn()

    def chunks():
        try:
            while chunk := upstream.read(1024 * 1024):
                yield chunk
        finally:
            close_upstream()

    max_age = max(0, min(3600, expires - int(time.time())))
    headers = {
        "Cache-Control": f"private, max-age={max_age}",
        "Accept-Ranges": "bytes",
        # Keep large objects streaming through Nginx instead of spilling them
        # into its proxy temp directory, which may be unavailable or unwritable.
        "X-Accel-Buffering": "no",
    }
    for name in ("Content-Length", "Content-Range", "ETag", "Last-Modified"):
        if value := upstream.headers.get(name):
            headers[name] = value
    # Serve via the application's origin: the storage endpoint may only be
    # reachable on the server, and rewriting a presigned host breaks its signature.
    return StreamingResponse(
        chunks(),
        status_code=upstream.status,
        media_type=upstream.headers.get("Content-Type", "application/octet-stream"),
        headers=headers,
        background=BackgroundTask(close_upstream),
    )
