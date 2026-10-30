"""Authenticated, same-origin gateway for the map features used by this app."""
from __future__ import annotations

import hashlib
import json
import re
import secrets
import time
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse

from app.api.dependencies import AuthenticatedSession, bearer_scheme, get_current_session
from app.core.config import get_settings
from app.db.session import get_db
from app.services.usage_control import SecurityStoreUnavailable, enforce_limit, get_usage_store

router = APIRouter(prefix="/maps", tags=["maps"])
proxy_router = APIRouter(include_in_schema=False)
COOKIE = "amap_session"
SESSION_TTL = 1800
MAX_RESPONSE = 2 * 1024 * 1024
# No generic proxy, IP lookup, custom styles, arbitrary target or SDK endpoint.
PARAMS = {
    "v3/geocode/geo": {"address", "city", "batch"},
    "v3/geocode/regeo": {"location", "radius", "extensions", "batch", "roadlevel", "poitype"},
    "v3/place/text": {"keywords", "city", "citylimit", "types", "offset", "page", "extensions", "children"},
}
SDK_PARAMS = {"key", "callback", "output", "s", "platform", "logversion", "appname", "csid", "sdkversion"}
CALLBACK = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*){0,4}")


def _ticket_key(ticket: str) -> str:
    return hashlib.sha256(ticket.encode()).hexdigest()


def _unavailable() -> HTTPException:
    return HTTPException(503, "地图服务暂时不可用，请稍后重试。")


async def protect_map_requests(request: Request, call_next):
    """Keep both error and success responses private and free of CORS grants."""
    path = request.url.path
    if not (path.startswith("/_AMapService") or path == f"{get_settings().api_prefix}/maps/session"):
        return await call_next(request)
    origin = request.headers.get("origin")
    own_origin = (request.url.scheme, request.url.netloc)
    try:
        parsed = urlsplit(origin) if origin else None
    except ValueError:
        parsed = urlsplit("https://invalid-origin.invalid")
    if (request.headers.get("sec-fetch-site") == "cross-site"
            or (parsed and (parsed.scheme, parsed.netloc) != own_origin)
            or request.method == "OPTIONS"):
        response = JSONResponse({"message": "地图服务仅允许同源访问。"}, status_code=403)
    else:
        response = await call_next(request)
    for name in list(response.headers):
        if name.lower().startswith("access-control-"):
            del response.headers[name]
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    return response


@router.post("/session")
def create_map_session(
    response: Response,
    session: AuthenticatedSession = Depends(get_current_session),
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict[str, str]:
    settings = get_settings()
    if not settings.amap_js_api_key or not settings.amap_security_js_code:
        raise _unavailable()
    ttl = min(SESSION_TTL, session.expires_at - int(time.time()))
    if ttl <= 0:
        raise HTTPException(401, "请重新登录。")
    ticket = secrets.token_urlsafe(32)
    try:
        store = get_usage_store()
        enforce_limit(store, "amap:session", str(session.user.id), limit=30,
                      ttl_seconds=60, detail="地图初始化过于频繁。")
        store.cache_set("amap-session", _ticket_key(ticket), {"token": credentials.credentials}, ttl_seconds=ttl)
    except SecurityStoreUnavailable as exc:
        raise _unavailable() from exc
    response.set_cookie(COOKIE, ticket, max_age=ttl, path="/_AMapService",
                        httponly=True, secure=settings.app_env in {"staging", "production"}, samesite="strict")
    # A JSAPI key is necessarily visible to the authenticated SDK client. Never return jscode.
    return {"key": settings.amap_js_api_key}


def map_session(request: Request, db: Session = Depends(get_db)) -> AuthenticatedSession:
    ticket = request.cookies.get(COOKIE, "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", ticket):
        raise HTTPException(401, "请先登录并初始化地图。")
    try:
        cached = get_usage_store().cache_get("amap-session", _ticket_key(ticket))
    except SecurityStoreUnavailable as exc:
        raise _unavailable() from exc
    if not cached or not isinstance(cached.get("token"), str):
        raise HTTPException(401, "地图会话已失效，请重新加载。")
    # Reuse the live account, expiry and logout revocation checks on EVERY request.
    return get_current_session(HTTPAuthorizationCredentials(scheme="Bearer", credentials=cached["token"]), db)


def _sanitize(value, credentials: tuple[str, ...]):
    if isinstance(value, dict):
        return {k: _sanitize(v, credentials) for k, v in value.items()
                if re.sub(r"[^a-z0-9]", "", k.lower()) not in {
                    "key", "apikey", "jscode", "securityjscode", "seccode", "seccodedebug"
                }}
    if isinstance(value, list):
        return [_sanitize(item, credentials) for item in value]
    if isinstance(value, str):
        for credential in credentials:
            if credential:
                value = value.replace(credential, "[redacted]")
    return value


async def _fetch_map(path: str, params: dict[str, str]) -> dict:
    # Fixed HTTPS host, no forwarded client headers/cookies, no redirects or env proxies.
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False, trust_env=False) as client:
            async with client.stream("GET", f"https://restapi.amap.com/{path}", params=params) as upstream:
                if upstream.status_code != 200:
                    raise HTTPException(502, "地图查询失败，请稍后重试。")
                body = bytearray()
                async for chunk in upstream.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_RESPONSE:
                        raise HTTPException(502, "地图响应异常。")
        data = json.loads(body)
    except (httpx.HTTPError, ValueError, UnicodeError) as exc:
        raise HTTPException(502, "地图查询失败，请稍后重试。") from exc
    if not isinstance(data, dict) or str(data.get("status")) != "1":
        # Never echo provider diagnostics, recycled keys or debug structures.
        raise HTTPException(502, "地图查询失败，请联系管理员检查地图配置。")
    return data


@proxy_router.get("/_AMapService")
@proxy_router.get("/_AMapService/{path:path}")
async def proxy_map(request: Request, path: str = "", session: AuthenticatedSession = Depends(map_session)):
    settings = get_settings()
    allowed = PARAMS.get(path)
    if allowed is None:
        raise HTTPException(404, "地图接口不存在。")
    if len(request.url.query) > 4096:
        raise HTTPException(400, "地图查询参数无效。")
    params: dict[str, str] = {}
    seen: set[str] = set()
    callback = ""
    for name, value in request.query_params.multi_items():
        if name in seen or name not in allowed | SDK_PARAMS or len(value) > 1024:
            raise HTTPException(400, "地图查询参数无效。")
        seen.add(name)
        if name == "key" and value != settings.amap_js_api_key:
            raise HTTPException(400, "地图查询参数无效。")
        if name == "callback":
            if len(value) > 128 or not CALLBACK.fullmatch(value):
                raise HTTPException(400, "地图回调参数无效。")
            callback = value
        if name == "batch" and value != "false":
            raise HTTPException(400, "不支持批量地图查询。")
        if name in {"offset", "page"} and (not value.isdecimal() or not 1 <= int(value) <= 25):
            raise HTTPException(400, "地图查询范围无效。")
        if name in (allowed | SDK_PARAMS) - {"key", "callback", "output"}:
            params[name] = value
    if not settings.amap_js_api_key or not settings.amap_security_js_code:
        raise _unavailable()
    try:
        enforce_limit(get_usage_store(), "amap:request", str(session.user.id),
                      limit=settings.amap_rate_limit_per_user, ttl_seconds=60, detail="地图查询过于频繁。")
    except SecurityStoreUnavailable as exc:
        raise _unavailable() from exc
    params.update(key=settings.amap_js_api_key, jscode=settings.amap_security_js_code, output="JSON")
    data = await _fetch_map(path, params)
    data = _sanitize(data, (settings.amap_js_api_key, settings.amap_security_js_code))
    if callback:
        # Serialize only parsed JSON; the callback is validated separately.
        return Response(f"{callback}({json.dumps(data, ensure_ascii=True)});", media_type="application/javascript")
    return JSONResponse(data)
