# Mock Algorithm Worker

This folder is intentionally separate from the FastAPI backend. The worker is an
algorithm-side adapter: it pulls tasks from the backend API, downloads photos
from the provided MinIO presigned URLs, and posts fixed mock detection JSON.

## Local Run

```powershell
$env:WORKER_BACKEND_BASE_URL = "http://localhost:8000"
$env:WORKER_ID = "mock-worker-local"
$env:WORKER_TOKEN = "change-this-worker-token"
$env:WORKER_MODEL_VERSION = "mock-facade-detector-v1"
python .\algorithm-worker\mock_worker.py
```

## Docker Run

```powershell
docker compose --profile worker run --rm algorithm-worker
```

Use `--skip-download` only when MinIO is not available and you only want to
exercise the API contract.
