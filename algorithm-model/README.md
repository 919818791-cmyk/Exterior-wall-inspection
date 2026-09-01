# Algorithm Model Container

> **Paused as of 2026-07-14:** the local YOLO model solution is currently suspended. This container, its weights, and the instructions below are retained for historical reference and are not part of the current deployment or acceptance scope.

This container is the production-side PyTorch / CUDA / Ultralytics runtime
boundary. It intentionally does not hold backend worker credentials and should
only be reachable from the Docker internal network.

Default GPU build uses the PyTorch CUDA 12.6 wheel index:

```bash
docker compose --profile algorithm-gpu build algorithm-model
docker compose --profile algorithm-gpu run --rm algorithm-model python verify_environment.py
```

Place the current trial weights under:

```text
models/wall_crack_yolo11x.pt
models/missing.pt
```

Or update `CRACK_MODEL_WEIGHTS_PATH` and `SPALLING_MODEL_WEIGHTS_PATH` in `.env`.

For CPU-only validation, set:

```bash
PYTORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
MODEL_DEVICE=cpu
```

The service exposes `/health`, `/ready`, `/metadata`, and `/predict`.
`/predict` accepts one uploaded image and returns detections normalized to:

| Type | Label |
| --- | --- |
| `crack` | 裂缝 |
| `spalling` | 剥落 |

Inference uses tiled/sliding-window prediction by default so high-resolution
photos keep enough detail for small facade defects. Each tile is predicted in
original-image coordinates, then detections are merged per defect type with
global NMS.

Tunable environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `MODEL_TILED_INFERENCE_ENABLED` | `true` | Enable tiled inference. Set `false` to return to full-image prediction. |
| `MODEL_TILE_SIZE` | `1280` | Tile side length for normal mode. |
| `MODEL_HIGH_PRECISION_TILE_SIZE` | `1280` | Tile side length when `high_precision=true`. |
| `MODEL_TILE_OVERLAP_RATIO` | `0.25` | Overlap ratio between adjacent tiles. |
| `MODEL_TILE_NMS_IOU_THRESHOLD` | `0.5` | IoU threshold used to merge duplicate boxes from overlapping tiles. |
