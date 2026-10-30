"""Real proxy verification. Run with backend/.venv Python from backend/."""
from datetime import datetime
import hashlib
import http.client
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit

import httpx
from dotenv import dotenv_values
from sqlalchemy import select

from app.api.dependencies import revoke_token
from app.core.security import create_access_token
from app.db.session import SessionLocal
from app.models.tables import Photo, TrialDetectionResult, UserAccount, YoloModelVersion
from app.services.object_storage import signed_object_url

evidence = {"time": datetime.now().astimezone().isoformat(), "checks": []}
folder = Path(__file__).resolve().parent


def record(name, **details):
    value = {"check": name, **details}
    evidence["checks"].append(value)
    print(json.dumps(value, ensure_ascii=False), flush=True)


def large_upload(path):
    # No Authorization: validates forwarding/spooling without creating a model.
    size = 110 * 1024 ** 2
    prefix = b'--nginx-audit\r\nContent-Disposition: form-data; name="file"; filename="audit.glb"\r\nContent-Type: application/octet-stream\r\n\r\n'
    suffix = b'\r\n--nginx-audit--\r\n'
    connection = http.client.HTTPConnection("127.0.0.1", 80, timeout=60)
    try:
        connection.putrequest("PUT", path)
        connection.putheader("Content-Type", "multipart/form-data; boundary=nginx-audit")
        connection.putheader("Content-Length", str(size + len(prefix) + len(suffix)))
        connection.endheaders()
        connection.send(prefix)
        chunk = b"0" * 1024 ** 2
        for _ in range(110):
            connection.send(chunk)
        connection.send(suffix)
        response = connection.getresponse()
        body = response.read()
        assert response.status == 401, (path, response.status)
        assert response.getheader("content-type").startswith("application/json")
        record("large_upload_reaches_auth", path=path, bytes=size, status=response.status)
    finally:
        connection.close()


with SessionLocal() as db:
    admin = db.scalar(select(UserAccount).where(UserAccount.role == "admin", UserAccount.status == "active", UserAccount.deleted_at.is_(None)))
    assert admin is not None
    token, expires, token_id = create_access_token(user_id=str(admin.id), role=admin.role)
    photo = db.scalar(select(Photo).where(Photo.deleted_at.is_(None)).order_by(Photo.file_size.desc()))
    trial = db.scalar(select(TrialDetectionResult).where(TrialDetectionResult.deleted_at.is_(None)))
    version = db.get(YoloModelVersion, "3bc76fa3-e1b3-4e0a-8d70-b6763e1331b7")

try:
    with httpx.Client(base_url="http://127.0.0.1", headers={"Authorization": f"Bearer {token}"}, trust_env=False, timeout=120, follow_redirects=False) as client:
        for path in ("/api/health", "/api/auth/me", "/api/yolo-models", "/api/vision-models", "/api/detection-strategies", "/api/projects", "/api/reports"):
            result = client.get(path)
            assert result.status_code == 200, (path, result.status_code)
            assert "application/json" in result.headers["content-type"]
            record("api", path=path, status=result.status_code)
        result = client.get("/api/nginx-audit-no-such-route")
        assert result.status_code == 404 and "application/json" in result.headers["content-type"]
        record("unknown_api_is_json_404", status=404)
        strategies = client.get("/api/detection-strategies").json()
        fields = ("key", "model_kind", "model_id", "version_id", "prompt")
        payload = {"items": [{key: item[key] for key in fields} for item in strategies]}
        size = len(json.dumps(payload, ensure_ascii=False).encode())
        result = client.put("/api/detection-strategies", json=payload)
        assert result.status_code == 200
        saved = client.get("/api/detection-strategies").json()
        assert saved == strategies
        record("strategy_save_unchanged", bytes=size, items=len(strategies), status=200)
        if photo:
            path = signed_object_url("/api", photo.storage_bucket, photo.storage_object_key)
            proxied = client.get(path)
            with httpx.Client(base_url="http://127.0.0.1:8000", trust_env=False, timeout=120) as backend:
                direct = backend.get(path)
            assert direct.status_code == proxied.status_code == 200
            digest = hashlib.sha256(proxied.content).hexdigest()
            assert digest == hashlib.sha256(direct.content).hexdigest()
            assert int(proxied.headers["content-length"]) == len(proxied.content)
            record("original_image_full", bytes=len(proxied.content), sha256=digest, status=200)
            part = client.get(path, headers={"Range": "bytes=0-65535"})
            assert part.status_code == 206 and part.content == proxied.content[:65536]
            record("range_download", status=206, content_range=part.headers["content-range"])
            expired = re.sub(r"expires=\d+", "expires=1", path)
            assert client.get(expired).status_code == 403
            record("expired_signed_url", status=403)
        if trial:
            result = client.get(f"/api/reports/{trial.id}/pdf")
            assert result.status_code == 200 and result.content.startswith(b"%PDF-")
            assert "attachment" in result.headers["content-disposition"]
            record("report_pdf_download", bytes=len(result.content), status=200)
        for path in ("/api/projects/00000000-0000-0000-0000-000000000000/building-model", "/api/projects/00000000-0000-0000-0000-000000000000/building-model-images"):
            large_upload(path)
        map_env = {}
        for name in (".env", ".env.local", ".env.production", ".env.production.local"):
            map_env.update(dotenv_values(folder.parents[1] / name))
        map_key = map_env.get("VITE_AMAP_KEY")
        result = client.get("/_AMapService/v3/geocode/geo", params={"key": map_key or "", "address": "深圳市南山区", "s": "rsv3"})
        data = result.json()
        assert result.status_code == 200
        record("amap_proxy", status=200, upstream_status=data.get("status"), upstream_info=data.get("info"))
        browser = subprocess.run(["node", str(folder / "browser.mjs")], input=token, capture_output=True, text=True, timeout=90)
        assert browser.returncode == 0, (browser.returncode, browser.stderr[:1000], browser.stdout[:1000])
        evidence["browser"] = json.loads(browser.stdout)
        record("browser", routes=len(evidence["browser"]["routes"]), server_errors=len(evidence["browser"]["failures"]), page_errors=len(evidence["browser"]["pageErrors"]))
finally:
    revoke_token(token_id, int(expires.timestamp()))
    (folder / "verification.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n")
