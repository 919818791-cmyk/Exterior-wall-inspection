from __future__ import annotations

import hashlib
import json
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from threading import Lock
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from redis import Redis
from redis.exceptions import RedisError

from app.core.config import Settings, get_settings


class SecurityStoreUnavailable(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class LimitResult:
    allowed: bool
    current: int
    retry_after: int


class UsageControlStore:
    """Atomic rate limits, quotas, locks and short-lived caches.

    Production uses Redis so limits are shared by all Uvicorn workers. The
    in-memory backend exists only for local development and isolated tests.
    """

    _CONSUME_SCRIPT = """
local current = redis.call('INCRBY', KEYS[1], ARGV[1])
if current == tonumber(ARGV[1]) then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
local ttl = redis.call('TTL', KEYS[1])
if current > tonumber(ARGV[3]) then
  redis.call('DECRBY', KEYS[1], ARGV[1])
  return {0, current, ttl}
end
return {1, current, ttl}
"""
    _REFUND_SCRIPT = """
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local next = current - tonumber(ARGV[1])
if next <= 0 then redis.call('DEL', KEYS[1]); return 0 end
redis.call('SET', KEYS[1], next, 'KEEPTTL')
return next
"""
    _RELEASE_LOCK_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
"""
    _ACQUIRE_SEMAPHORE_SCRIPT = """
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('ZADD', KEYS[1], tonumber(ARGV[3]), ARGV[4])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
return 1
"""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._redis = (
            Redis.from_url(self.settings.redis_url, decode_responses=True)
            if self.settings.security_store_backend == "redis"
            else None
        )
        self._memory: dict[str, tuple[Any, float | None]] = {}
        self._memory_lock = Lock()

    def consume(self, scope: str, identity: str, *, amount: int, limit: int, ttl_seconds: int) -> LimitResult:
        key = self._key(scope, identity)
        if self._redis is not None:
            try:
                raw = self._redis.eval(
                    self._CONSUME_SCRIPT,
                    1,
                    key,
                    amount,
                    ttl_seconds,
                    limit,
                )
                return LimitResult(bool(raw[0]), int(raw[1]), max(1, int(raw[2])))
            except RedisError as exc:
                return self._redis_failure(exc)

        now = time.time()
        with self._memory_lock:
            self._purge_memory(now)
            current, expiry = self._memory.get(key, (0, now + ttl_seconds))
            proposed = int(current) + amount
            retry_after = max(1, int((expiry or now + ttl_seconds) - now))
            if proposed > limit:
                return LimitResult(False, proposed, retry_after)
            self._memory[key] = (proposed, expiry)
            return LimitResult(True, proposed, retry_after)

    def refund(self, scope: str, identity: str, *, amount: int) -> None:
        key = self._key(scope, identity)
        if self._redis is not None:
            try:
                self._redis.eval(self._REFUND_SCRIPT, 1, key, amount)
                return
            except RedisError as exc:
                self._redis_failure(exc)
                return
        with self._memory_lock:
            current, expiry = self._memory.get(key, (0, None))
            next_value = max(0, int(current) - amount)
            if next_value:
                self._memory[key] = (next_value, expiry)
            else:
                self._memory.pop(key, None)

    def acquire_lock(self, scope: str, identity: str, *, ttl_seconds: int) -> str | None:
        key = self._key(scope, identity)
        token = secrets.token_urlsafe(18)
        if self._redis is not None:
            try:
                return token if self._redis.set(key, token, nx=True, ex=ttl_seconds) else None
            except RedisError as exc:
                self._redis_failure(exc)
                return None
        now = time.time()
        with self._memory_lock:
            self._purge_memory(now)
            if key in self._memory:
                return None
            self._memory[key] = (token, now + ttl_seconds)
            return token

    def release_lock(self, scope: str, identity: str, token: str) -> None:
        key = self._key(scope, identity)
        if self._redis is not None:
            try:
                self._redis.eval(self._RELEASE_LOCK_SCRIPT, 1, key, token)
                return
            except RedisError as exc:
                self._redis_failure(exc)
                return
        with self._memory_lock:
            current = self._memory.get(key)
            if current and current[0] == token:
                self._memory.pop(key, None)

    def acquire_semaphore(self, scope: str, *, limit: int, ttl_seconds: int) -> str | None:
        key = self._key("semaphore", scope)
        token = secrets.token_urlsafe(18)
        now = int(time.time())
        if self._redis is not None:
            try:
                allowed = self._redis.eval(
                    self._ACQUIRE_SEMAPHORE_SCRIPT,
                    1,
                    key,
                    now,
                    limit,
                    now + ttl_seconds,
                    token,
                    ttl_seconds,
                )
                return token if allowed else None
            except RedisError as exc:
                self._redis_failure(exc)
                return None
        with self._memory_lock:
            self._purge_memory(time.time())
            members = dict(self._memory.get(key, ({}, None))[0])
            members = {item: expiry for item, expiry in members.items() if expiry > now}
            if len(members) >= limit:
                self._memory[key] = (members, now + ttl_seconds)
                return None
            members[token] = now + ttl_seconds
            self._memory[key] = (members, now + ttl_seconds)
            return token

    def release_semaphore(self, scope: str, token: str) -> None:
        key = self._key("semaphore", scope)
        if self._redis is not None:
            try:
                self._redis.zrem(key, token)
                return
            except RedisError as exc:
                self._redis_failure(exc)
                return
        with self._memory_lock:
            members, expiry = self._memory.get(key, ({}, None))
            members = dict(members)
            members.pop(token, None)
            if members:
                self._memory[key] = (members, expiry)
            else:
                self._memory.pop(key, None)

    def cache_get(self, scope: str, identity: str) -> dict[str, Any] | None:
        key = self._key(f"cache:{scope}", identity)
        if self._redis is not None:
            try:
                value = self._redis.get(key)
            except RedisError as exc:
                self._redis_failure(exc)
                return None
        else:
            now = time.time()
            with self._memory_lock:
                self._purge_memory(now)
                value = self._memory.get(key, (None, None))[0]
        if value is None:
            return None
        try:
            return json.loads(value) if isinstance(value, str) else value
        except (TypeError, json.JSONDecodeError):
            return None

    def cache_set(self, scope: str, identity: str, value: dict[str, Any], *, ttl_seconds: int) -> None:
        key = self._key(f"cache:{scope}", identity)
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)
        if self._redis is not None:
            try:
                self._redis.setex(key, ttl_seconds, encoded)
                return
            except RedisError as exc:
                self._redis_failure(exc)
                return
        with self._memory_lock:
            self._memory[key] = (encoded, time.time() + ttl_seconds)

    def token_is_revoked(self, token_id: str) -> bool:
        key = self._key("revoked-token", token_id)
        if self._redis is not None:
            try:
                return bool(self._redis.exists(key))
            except RedisError as exc:
                result = self._redis_failure(exc)
                return not result.allowed
        with self._memory_lock:
            self._purge_memory(time.time())
            return key in self._memory

    def revoke_token(self, token_id: str, expires_at: int) -> None:
        ttl = max(1, expires_at - int(time.time()))
        key = self._key("revoked-token", token_id)
        if self._redis is not None:
            try:
                self._redis.setex(key, ttl, "1")
                return
            except RedisError as exc:
                self._redis_failure(exc)
                return
        with self._memory_lock:
            self._memory[key] = ("1", time.time() + ttl)

    def clear(self) -> None:
        if self._redis is None:
            with self._memory_lock:
                self._memory.clear()

    def _key(self, scope: str, identity: str) -> str:
        digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
        return f"{self.settings.security_key_prefix}:{scope}:{digest}"

    def _purge_memory(self, now: float) -> None:
        expired = [key for key, (_, expiry) in self._memory.items() if expiry is not None and expiry <= now]
        for key in expired:
            self._memory.pop(key, None)

    def _redis_failure(self, exc: RedisError) -> LimitResult:
        if self.settings.security_fail_closed:
            raise SecurityStoreUnavailable("安全配额服务暂时不可用。") from exc
        return LimitResult(True, 0, 1)


@lru_cache
def get_usage_store() -> UsageControlStore:
    return UsageControlStore()


def reset_usage_store() -> None:
    if get_usage_store.cache_info().currsize:
        get_usage_store().clear()
    get_usage_store.cache_clear()


def enforce_limit(
    store: UsageControlStore,
    scope: str,
    identity: str,
    *,
    limit: int,
    ttl_seconds: int,
    amount: int = 1,
    detail: str = "请求过于频繁，请稍后重试。",
) -> None:
    try:
        result = store.consume(scope, identity, amount=amount, limit=limit, ttl_seconds=ttl_seconds)
    except SecurityStoreUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    if not result.allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=detail,
            headers={"Retry-After": str(result.retry_after)},
        )


def seconds_until_next_day(timezone_name: str = "Asia/Shanghai") -> int:
    now = datetime.now(ZoneInfo(timezone_name))
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((tomorrow - now).total_seconds()))


def daily_identity(identity: str, timezone_name: str = "Asia/Shanghai") -> str:
    today = datetime.now(ZoneInfo(timezone_name)).date().isoformat()
    return f"{identity}:{today}"
