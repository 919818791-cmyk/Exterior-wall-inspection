# Algorithm Worker

This folder is intentionally separate from the FastAPI backend. The worker is an
algorithm-side adapter: it pulls tasks from the backend API, downloads photos
from the provided MinIO presigned URLs, and posts detection JSON.

`WORKER_MODE=mock` posts fixed data for API contract tests. `WORKER_MODE=real`
calls the private algorithm model service at `ALGORITHM_INFERENCE_URL`.

Current defect type mapping:

| Type | Label |
| --- | --- |
| `crack` | 裂缝 |
| `spalling` | 剥落 |

## Local Run

```powershell
$env:WORKER_BACKEND_BASE_URL = "http://localhost:8000"
$env:WORKER_ID = "mock-worker-local"
$env:WORKER_TOKEN = "change-this-worker-token"
$env:WORKER_MODEL_VERSION = "trial-crack-spalling-v1"
$env:WORKER_MODE = "mock"
python .\algorithm-worker\mock_worker.py
```

## Docker Run

```powershell
docker compose --profile worker run --rm algorithm-worker
```

Use `--skip-download` only when MinIO is not available and you only want to
exercise the API contract in mock mode.
