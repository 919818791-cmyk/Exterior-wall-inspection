from __future__ import annotations

import json
import os
from pathlib import Path

import torch
import ultralytics


def main() -> int:
    model_paths = {
        "crack": Path(os.getenv("CRACK_MODEL_WEIGHTS_PATH", "/models/wall_crack_yolo11x.pt")),
        "spalling": Path(
            os.getenv(
                "SPALLING_MODEL_WEIGHTS_PATH",
                os.getenv("MISSING_MODEL_WEIGHTS_PATH", "/models/missing.pt"),
            )
        ),
    }
    cuda_available = torch.cuda.is_available()
    payload = {
        "torch_version": torch.__version__,
        "torch_cuda_version": torch.version.cuda,
        "cuda_available": cuda_available,
        "cuda_device_count": torch.cuda.device_count() if cuda_available else 0,
        "cuda_devices": [
            {
                "index": index,
                "name": torch.cuda.get_device_name(index),
                "capability": torch.cuda.get_device_capability(index),
            }
            for index in range(torch.cuda.device_count())
        ] if cuda_available else [],
        "ultralytics_version": ultralytics.__version__,
        "model_weights": {
            defect_type: {
                "path": str(path),
                "exists": path.exists(),
            }
            for defect_type, path in model_paths.items()
        },
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
