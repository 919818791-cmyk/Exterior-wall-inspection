from datetime import datetime
import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory, gettempdir
from uuid import uuid4

import httpx
from sqlalchemy import select

from app.api.dependencies import revoke_token
from app.core.security import create_access_token
from app.db.session import SessionLocal
from app.models.tables import Photo, UserAccount
from app.services.object_storage import get_object_bytes

root = Path(__file__).resolve().parents[2]
with SessionLocal() as db:
    user = db.scalar(select(UserAccount).where(UserAccount.role == 'admin', UserAccount.status == 'active', UserAccount.deleted_at.is_(None)))
    sample = db.scalar(select(Photo).where(Photo.deleted_at.is_(None), Photo.precheck_status == 'passed', Photo.file_size > 1024 * 1024).limit(1))
    assert sample is not None
    image_bytes = get_object_bytes(sample.storage_bucket, sample.storage_object_key)
    token, expires, token_id = create_access_token(user_id=str(user.id), role=user.role)
project_id = None
browser_result = {}
try:
    with httpx.Client(base_url='http://127.0.0.1', headers={'Authorization': f'Bearer {token}'}, trust_env=False, timeout=120) as client:
        response = client.post('/api/projects/drafts', json={'name': '上传修复验证（临时）', 'facade_type': 'tile', 'client_draft_key': f'upload-check-{uuid4().hex}'})
        assert response.status_code == 201, response.text
        project_id = response.json()['id']
        with TemporaryDirectory(prefix='photo-upload-check-', dir='/var/tmp') as folder:
            sample_path = Path(folder) / 'upload-verification.jpg'
            sample_path.write_bytes(image_bytes)
            config = {'token': token, 'samplePath': str(sample_path), 'sampleName': sample_path.name, 'projectId': project_id}
            result = subprocess.run(['node', str(root / 'audit/photo-upload/verify-browser.mjs')], input=json.dumps(config), capture_output=True, text=True, cwd=root, timeout=300, env={**os.environ, 'TMPDIR': gettempdir()})
            assert result.stdout.strip(), result.stderr[:1000]
            browser_result = json.loads(result.stdout)
            assert result.returncode == 0, (browser_result, result.stderr[:1000])
        # Both endpoints must parse a spooled multipart body and reach auth even
        # through Nginx; this neither stores photos nor invokes inference.
        with httpx.Client(trust_env=False, timeout=120) as anonymous:
            for origin in ('http://127.0.0.1', 'http://127.0.0.1:8000'):
                for route in ('/api/trial/photos', '/api/photos/upload'):
                    response = anonymous.post(origin + route, files={'file': ('large.jpg', image_bytes, 'image/jpeg')})
                    assert response.status_code == 401, (origin, route, response.text)
        print(json.dumps({'browser': browser_result['observations'], 'auth_checks': 4, 'sample_bytes': len(image_bytes)}, ensure_ascii=False))
finally:
    with httpx.Client(base_url='http://127.0.0.1', headers={'Authorization': f'Bearer {token}'}, trust_env=False, timeout=120) as client:
        # Only clean up records created by this verification run.
        for uploaded in browser_result.get('uploadIds', []):
            if uploaded.get('id'):
                path = f"/api/trial/photos/{uploaded['id']}" if uploaded['kind'] == 'trial' else f"/api/photos/{uploaded['id']}"
                response = client.delete(path)
                assert response.status_code == 200, response.text
        if project_id:
            response = client.delete(f'/api/projects/{project_id}')
            assert response.status_code == 200, response.text
    revoke_token(token_id, int(expires.timestamp()))
    evidence = {'time': datetime.now().astimezone().isoformat(), **browser_result, 'temporary_records_cleaned': True}
    evidence.pop('uploadIds', None)
    (root / 'audit/photo-upload/verification.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n')
