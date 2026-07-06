from __future__ import annotations

import hashlib
import hmac
import time
from datetime import timedelta
from urllib.parse import quote, urlparse

from minio import Minio
from minio.error import S3Error

from app.core.config import get_settings


def _client() -> Minio:
    settings = get_settings()
    endpoint_value = settings.minio_endpoint
    parsed = urlparse(endpoint_value)
    if "://" in endpoint_value and parsed.scheme and parsed.netloc:
        endpoint = parsed.netloc
        secure = parsed.scheme == "https"
    else:
        endpoint = endpoint_value
        secure = settings.minio_public_url.startswith("https://")

    return Minio(
        endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=secure,
    )


def ensure_bucket() -> str:
    settings = get_settings()
    client = _client()
    bucket = settings.minio_bucket
    if not client.bucket_exists(bucket):
        client.make_bucket(bucket)
    return bucket


def put_object(
    object_key: str,
    data,
    length: int,
    content_type: str | None = None,
) -> str:
    bucket = ensure_bucket()
    _client().put_object(
        bucket,
        object_key,
        data,
        length=length,
        content_type=content_type or "application/octet-stream",
    )
    return bucket


def remove_object(bucket: str, object_key: str | None) -> None:
    if not object_key:
        return
    try:
        _client().remove_object(bucket, object_key)
    except S3Error:
        return


def get_object_bytes(bucket: str, object_key: str) -> bytes:
    response = _client().get_object(bucket, object_key)
    try:
        return response.read()
    finally:
        response.close()
        response.release_conn()


def presigned_get_url(bucket: str, object_key: str | None, expires_minutes: int = 60) -> str | None:
    if not object_key:
        return None
    return _client().presigned_get_object(
        bucket,
        object_key,
        expires=timedelta(minutes=expires_minutes),
    )


def signed_object_url(
    api_base_url: str,
    bucket: str | None,
    object_key: str | None,
    *,
    expires_minutes: int = 60,
) -> str | None:
    if not bucket or not object_key:
        return None
    expires_at = int(time.time()) + expires_minutes * 60
    signature = sign_object_access(bucket, object_key, expires_at)
    encoded_bucket = quote(bucket, safe="")
    encoded_key = quote(object_key, safe="/")
    return (
        f"{api_base_url.rstrip('/')}/object-storage/{encoded_bucket}/{encoded_key}"
        f"?expires={expires_at}&signature={signature}"
    )


def sign_object_access(bucket: str, object_key: str, expires_at: int) -> str:
    settings = get_settings()
    payload = f"{bucket}\n{object_key}\n{expires_at}".encode("utf-8")
    secret = settings.auth_secret_key.encode("utf-8")
    return hmac.new(secret, payload, hashlib.sha256).hexdigest()


def verify_object_access(bucket: str, object_key: str, expires_at: int, signature: str) -> bool:
    if expires_at < int(time.time()):
        return False
    expected = sign_object_access(bucket, object_key, expires_at)
    return hmac.compare_digest(expected, signature)
