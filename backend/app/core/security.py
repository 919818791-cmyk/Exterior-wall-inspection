from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.config import get_settings


def hash_password(password: str) -> str:
    """Create a salted scrypt hash without adding a deployment dependency."""
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1)
    return "scrypt$" + "$".join(
        base64.urlsafe_b64encode(value).decode("ascii").rstrip("=") for value in (salt, digest)
    )


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, encoded_salt, encoded_digest = password_hash.split("$", maxsplit=2)
        if algorithm != "scrypt":
            return False
        salt = _decode(encoded_salt)
        expected = _decode(encoded_digest)
        actual = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1)
        return hmac.compare_digest(actual, expected)
    except (TypeError, ValueError):
        return False


def create_access_token(*, user_id: str, role: str) -> tuple[str, datetime, str]:
    settings = get_settings()
    now = datetime.now(UTC)
    expires_at = now + timedelta(minutes=settings.auth_access_token_expire_minutes)
    token_id = secrets.token_urlsafe(18)
    payload = {
        "sub": user_id,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": token_id,
    }
    encoded_payload = _encode_json(payload)
    signature = _sign(encoded_payload)
    return f"{encoded_payload}.{signature}", expires_at, token_id


def decode_access_token(token: str) -> dict[str, Any] | None:
    try:
        encoded_payload, signature = token.split(".", maxsplit=1)
        if not hmac.compare_digest(signature, _sign(encoded_payload)):
            return None
        payload = json.loads(_decode(encoded_payload).decode("utf-8"))
        if not isinstance(payload, dict):
            return None
        if not isinstance(payload.get("sub"), str) or not isinstance(payload.get("jti"), str):
            return None
        if not isinstance(payload.get("exp"), int) or payload["exp"] <= int(datetime.now(UTC).timestamp()):
            return None
        return payload
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def _encode_json(value: dict[str, Any]) -> str:
    raw = json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _sign(encoded_payload: str) -> str:
    secret = get_settings().auth_secret_key.encode("utf-8")
    digest = hmac.new(secret, encoded_payload.encode("ascii"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
