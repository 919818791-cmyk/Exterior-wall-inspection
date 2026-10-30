from types import SimpleNamespace
from uuid import UUID
import importlib.util
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api import maps
from app.api.dependencies import revoke_token
from app.core.config import get_settings
from app.core.security import create_access_token
from app.db.session import get_db
from app.main import app
from app.services.usage_control import SecurityStoreUnavailable


@pytest.fixture
def gateway(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "amap_js_api_key", "test-map-public-key")
    monkeypatch.setattr(settings, "amap_security_js_code", "test-map-private-code")
    monkeypatch.setattr(settings, "amap_rate_limit_per_user", 60)
    user = SimpleNamespace(id=UUID(int=1), username="map-user", real_name=None, role="customer", organization=None, phone=None)
    db = SimpleNamespace(scalar=lambda _: user)
    app.dependency_overrides[get_db] = lambda: db
    calls = []

    async def fetch(path, params):
        calls.append((path, params))
        return {"status": "1", "info": "OK", "geocodes": [{"location": "114,22", "key": "secret"}],
                "key": "secret", "sec_code": "secret", "sec_code_debug": {"secret": True},
                "nested": {"SecurityJsCode": "secret", "message": "url?key=test-map-public-key&jscode=test-map-private-code"}}

    monkeypatch.setattr(maps, "_fetch_map", fetch)
    token, _, token_id = create_access_token(user_id=str(user.id), role=user.role)
    with TestClient(app) as client:
        yield client, {"Authorization": f"Bearer {token}"}, calls, db, token_id
    app.dependency_overrides.pop(get_db, None)


def initialize(client, headers):
    result = client.post("/api/maps/session", headers=headers)
    assert result.status_code == 200
    return result


@pytest.mark.parametrize("path", ["/_AMapService", "/_AMapService/", "/_AMapService/v3/geocode/geo", "/_AMapService/v3/ip"])
def test_anonymous_requests_never_reach_upstream(gateway, path):
    client, _, calls, _, _ = gateway
    assert client.get(path).status_code == 401
    assert client.post("/api/maps/session").status_code == 401
    assert calls == []


def test_success_filters_secrets_and_preserves_sdk_jsonp(gateway):
    client, headers, calls, _, _ = gateway
    result = initialize(client, headers)
    assert result.json() == {"key": "test-map-public-key"}
    cookie = result.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=strict" in cookie and "Path=/_AMapService" in cookie
    result = client.get("/_AMapService/v3/geocode/geo", params={"address": "深圳", "callback": "AMap._callback1", "key": "test-map-public-key"})
    assert result.status_code == 200
    assert result.text.startswith("AMap._callback1(")
    assert '"location": "114,22"' in result.text
    for secret in ("test-map-public-key", "test-map-private-code", '"key"', "sec_code", "SecurityJsCode"):
        assert secret not in result.text
    assert calls[0][1] == {"address": "深圳", "key": "test-map-public-key", "jscode": "test-map-private-code", "output": "JSON"}
    assert result.headers["cache-control"] == "private, no-store"
    assert not any(k.startswith("access-control-") for k in result.headers)


@pytest.mark.parametrize("suffix", ["v3/ip", "v4/map/styles", "https://evil.test", "v3/geocode/geo?url=https://evil.test",
    "v3/geocode/geo?jscode=attacker", "v3/geocode/geo?sec_code=attacker", "v3/geocode/geo?key=other",
    "v3/geocode/geo?address=a&address=b", "v3/geocode/geo?callback=alert(1)", "v3/geocode/geo?batch=true",
    "v3/place/text?offset=1000"])
def test_non_business_routes_and_parameter_injection_are_blocked(gateway, suffix):
    client, headers, calls, _, _ = gateway
    initialize(client, headers)
    assert client.get(f"/_AMapService/{suffix}").status_code in {400, 404}
    assert calls == []


@pytest.mark.parametrize("headers", [{"Origin": "https://evil.test"}, {"Sec-Fetch-Site": "cross-site"}])
def test_cross_origin_requests_are_denied_even_with_cookie(gateway, headers):
    client, auth, calls, _, _ = gateway
    initialize(client, auth)
    result = client.get("/_AMapService/v3/geocode/geo", headers=headers)
    assert result.status_code == 403
    assert "access-control-allow-origin" not in result.headers
    assert client.options("/_AMapService/v3/geocode/geo", headers={"Origin": "https://evil.test", "Access-Control-Request-Method": "GET"}).status_code == 403
    assert calls == []


def test_logout_and_disabled_accounts_invalidate_map_session(gateway):
    client, headers, calls, db, token_id = gateway
    initialize(client, headers)
    db.scalar = lambda _: None
    assert client.get("/_AMapService/v3/geocode/geo").status_code == 401
    revoke_token(token_id, 9999999999)
    assert client.get("/_AMapService/v3/geocode/geo").status_code == 401
    assert calls == []


def test_expired_or_forged_tickets_are_denied(gateway):
    client, _, calls, _, _ = gateway
    client.cookies.set(maps.COOKIE, "A" * 43, path="/_AMapService")
    assert client.get("/_AMapService/v3/geocode/geo").status_code == 401
    assert calls == []


def test_rate_limit_and_security_store_fail_closed(gateway, monkeypatch):
    client, headers, calls, _, _ = gateway
    initialize(client, headers)
    monkeypatch.setattr(get_settings(), "amap_rate_limit_per_user", 1)
    assert client.get("/_AMapService/v3/geocode/geo").status_code == 200
    assert client.get("/_AMapService/v3/geocode/geo").status_code == 429
    assert len(calls) == 1
    def fail():
        raise SecurityStoreUnavailable("internal redis credentials")
    monkeypatch.setattr(maps, "get_usage_store", fail)
    response = client.get("/_AMapService/v3/geocode/geo")
    assert response.status_code == 503
    assert "redis" not in response.text


def test_production_cookie_is_secure(gateway, monkeypatch):
    client, headers, _, _, _ = gateway
    monkeypatch.setattr(get_settings(), "app_env", "production")
    assert "Secure" in initialize(client, headers).headers["set-cookie"]


@pytest.mark.parametrize("body,status", [
    (b'{"status":"0","info":"USER_KEY_RECYCLED","infocode":"10013","sec_code_debug":"secret"}', 200),
    (b'callback({"key":"secret"})', 200), (b'{"status":"1"}', 302),
    (b'x' * (maps.MAX_RESPONSE + 1), 200), (b'[]', 200),
])
def test_upstream_errors_and_oversized_responses_are_not_forwarded(monkeypatch, body, status):
    import asyncio
    original_client = httpx.AsyncClient
    def handle(request):
        assert request.url.host == "restapi.amap.com"
        assert "cookie" not in request.headers and "authorization" not in request.headers
        return httpx.Response(status, content=body, headers={"Access-Control-Allow-Origin": "*", "Location": "https://evil.test"})
    def client(**kwargs):
        assert kwargs["follow_redirects"] is False and kwargs["trust_env"] is False
        return original_client(**kwargs, transport=httpx.MockTransport(handle))
    monkeypatch.setattr(httpx, "AsyncClient", client)
    with pytest.raises(Exception) as error:
        asyncio.run(maps._fetch_map("v3/geocode/geo", {"key": "secret"}))
    assert error.value.status_code == 502
    assert "secret" not in error.value.detail and "10013" not in error.value.detail


def test_nginx_migration_removes_all_legacy_upstreams_and_is_repeatable():
    path = Path(__file__).resolve().parents[2] / "deploy/configure-nginx-amap.py"
    spec = importlib.util.spec_from_file_location("configure_amap_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    config = '''server {
    location /_AMapService/v4/map/styles { set $args "$args&jscode=secret"; proxy_pass https://webapi.amap.com; }
    location /_AMapService/ { proxy_pass https://restapi.amap.com/; }
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
    }
}'''
    updated = module.configure(config)
    assert "jscode" not in updated and "amap.com" not in updated
    assert "location ^~ /_AMapService" in updated
    assert "location = /api/maps/session" in updated
    assert updated.count("location ^~ /_AMapService") == 1
    assert module.configure(updated) == updated


@pytest.mark.parametrize("path,params", [
    ("v3/geocode/geo", {"address": "深圳"}),
    ("v3/geocode/regeo", {"location": "114,22", "extensions": "all", "radius": "1000"}),
    ("v3/place/text", {"keywords": "深圳", "page": "1", "offset": "10"}),
])
def test_business_routes_preserve_sdk_platform_parameters(gateway, path, params):
    client, headers, calls, _, _ = gateway
    initialize(client, headers)
    params.update(s="rsv3", platform="JS", logversion="2.0")
    response = client.get(f"/_AMapService/{path}", params=params)
    assert response.status_code == 200
    assert response.json()["status"] == "1"
    assert all(calls[0][1][name] == value for name, value in params.items())
