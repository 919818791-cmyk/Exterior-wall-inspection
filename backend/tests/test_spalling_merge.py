import asyncio
from copy import deepcopy
from datetime import UTC, datetime
from io import BytesIO
import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
from PIL import Image
import pytest

from app.api import detection_tasks, reports
from app.services import detection_strategies, trial_qwen_inference as tiling, yolo_inference, yolo_runtime


def detection(box, tile=None, *, kind="spalling", confidence=0.85):
    x, y, width, height = box
    result = {
        "type": kind,
        "confidence": confidence,
        "bbox": {"x": x, "y": y, "width": width, "height": height},
        "description": "面砖脱落露出基层",
    }
    if tile is not None:
        result["_source_tile"] = tile
    return result


def merge(values):
    return tiling._merge_cross_tile_duplicate_boxes(
        values, ios_threshold=tiling.CROSS_TILE_MERGE_IOS_THRESHOLD
    )


@pytest.mark.parametrize(
    ("tiles", "boxes", "expected"),
    [
        (
            [(0, 0, 1280, 960), (960, 0, 1280, 960)],
            [(100, 200, 1180, 400), (960, 200, 1000, 400)],
            {"x": 100, "y": 200, "width": 1860, "height": 400},
        ),
        (
            [(0, 0, 1280, 960), (0, 720, 1280, 960)],
            [(200, 100, 400, 860), (200, 720, 400, 800)],
            {"x": 200, "y": 100, "width": 400, "height": 1420},
        ),
        (
            [(0, 0, 1280, 960), (960, 720, 1280, 960)],
            [(100, 100, 1180, 860), (960, 720, 1000, 800)],
            {"x": 100, "y": 100, "width": 1860, "height": 1420},
        ),
        # TRY-20261013-002 / DJI_0277_W.JPG: vertical fragments just below
        # the old 0.60 full-box IoS threshold, truncated at y=1680 / y=1440.
        (
            [(4800, 720, 1280, 960), (4800, 1440, 1280, 960)],
            [(5117.44, 1296, 90.88, 383.04), (5121.28, 1440, 88.32, 429.12)],
            {"x": 5117.44, "y": 1296, "width": 92.16, "height": 573.12},
        ),
        # Allow small grounding errors at the facing tile boundaries.
        (
            [(0, 0, 1280, 960), (960, 0, 1280, 960)],
            [(100, 200, 1170, 400), (965, 205, 990, 390)],
            {"x": 100, "y": 200, "width": 1855, "height": 400},
        ),
    ],
)
@pytest.mark.parametrize("reverse", [False, True])
def test_spalling_fragments_match_in_tile_overlap_band(tiles, boxes, expected, reverse):
    values = [detection(box, tiling._Tile(*tile)) for tile, box in zip(tiles, boxes, strict=True)]
    assert tiling._bbox_intersection_over_smaller(values[0]["bbox"], values[1]["bbox"]) < 0.6
    if reverse:
        values.reverse()
    original = deepcopy(values)
    merged = merge(values)
    assert len(merged) == 1
    assert merged[0]["bbox"] == pytest.approx(expected)
    assert values == original


def test_spalling_region_spanning_three_tiles_merges_transitively():
    values = [
        detection((100, 200, 1180, 400), tiling._Tile(0, 0, 1280, 960)),
        detection((960, 200, 1280, 400), tiling._Tile(960, 0, 1280, 960)),
        detection((1920, 200, 700, 400), tiling._Tile(1920, 0, 880, 960)),
    ]
    merged = merge(values)
    assert len(merged) == 1
    assert merged[0]["bbox"] == {"x": 100, "y": 200, "width": 2520, "height": 400}


@pytest.mark.parametrize("kind", ["crack", "peeling", "damage", "hollow"])
def test_overlap_band_continuity_only_applies_to_spalling(kind):
    values = [
        detection((100, 200, 1180, 400), tiling._Tile(0, 0, 1280, 960), kind=kind),
        detection((960, 200, 1000, 400), tiling._Tile(960, 0, 1280, 960), kind=kind),
    ]
    assert merge(values) == values


@pytest.mark.parametrize(
    ("left_box", "right_box", "right_tile"),
    [
        # Independent regions separated along the perpendicular axis.
        ((100, 100, 1180, 200), (960, 400, 1000, 200), (960, 0, 1280, 960)),
        # Partial shared-band overlap is insufficient evidence of continuity.
        ((100, 100, 1180, 400), (960, 400, 1000, 400), (960, 0, 1280, 960)),
        # Strong band overlap, but the left region ends before its tile edge.
        ((100, 200, 1120, 400), (960, 200, 1000, 400), (960, 0, 1280, 960)),
        # Strong band overlap, but the right region starts inside its tile.
        ((100, 200, 1180, 400), (1020, 200, 1000, 400), (960, 0, 1280, 960)),
        # Two boxes from the same tile retain their separate identities.
        ((100, 200, 1180, 400), (960, 200, 300, 400), (0, 0, 1280, 960)),
        # Spatial proximity across non-overlapping tiles does not merge.
        ((100, 200, 1180, 400), (1280, 200, 1000, 400), (1280, 0, 1280, 960)),
    ],
)
def test_independent_spalling_regions_remain_separate(left_box, right_box, right_tile):
    values = [
        detection(left_box, tiling._Tile(0, 0, 1280, 960)),
        detection(right_box, tiling._Tile(*right_tile)),
    ]
    assert merge(values) == values


def test_overlap_band_does_not_merge_different_defect_types():
    values = [
        detection((100, 200, 1180, 400), tiling._Tile(0, 0, 1280, 960)),
        detection((960, 200, 1000, 400), tiling._Tile(960, 0, 1280, 960), kind="crack"),
    ]
    assert merge(values) == values


def test_global_containment_keeps_full_region_and_best_confidence_without_tile_metadata():
    values = [
        detection((100, 200, 500, 400), confidence=0.78),
        detection((200, 300, 150, 100), confidence=0.95),
        detection((700, 200, 100, 100)),
        detection((200, 300, 150, 100), kind="crack"),
    ]
    original = deepcopy(values)
    merged = tiling._merge_contained_spalling_boxes(values)
    assert len(merged) == 3
    assert merged[0]["bbox"] == values[0]["bbox"]
    assert merged[0]["confidence"] == 0.95
    assert merged[1:] == values[2:]
    assert values == original


def test_global_containment_does_not_absorb_a_chain_of_neighbors():
    values = [
        detection((0, 0, 100, 100)),
        detection((20, 0, 88, 100)),
        detection((30, 0, 84, 100)),
    ]
    merged = tiling._merge_contained_spalling_boxes(values)
    assert len(merged) == 2
    assert merged[0]["bbox"] == {"x": 0, "y": 0, "width": 108, "height": 100}
    assert merged[1]["bbox"] == values[2]["bbox"]


def test_existing_trial_nested_spalling_boxes_merge_without_losing_coverage():
    # TRY-20261013-002 / DJI_0409_W.JPG: the smaller region is completely
    # contained, but its full-box IoU is only 0.427 and survives legacy NMS.
    values = [
        detection((2599.68, 2770.56, 636.16, 487.68), confidence=0.92),
        detection((2880, 2880, 352, 376.32), confidence=0.78),
    ]
    assert tiling._bbox_iou(values[0]["bbox"], values[1]["bbox"]) < 0.5
    merged = tiling._merge_contained_spalling_boxes(values)
    assert len(merged) == 1
    assert merged[0]["bbox"] == pytest.approx(values[0]["bbox"])
    assert merged[0]["confidence"] == 0.92


@pytest.mark.parametrize("kind", ["crack", "peeling", "damage", "hollow"])
def test_global_containment_only_applies_to_spalling(kind):
    values = [detection((0, 0, 100, 100), kind=kind), detection((10, 10, 10, 10), kind=kind)]
    assert tiling._merge_contained_spalling_boxes(values) == values


def test_pipeline_cleans_containment_before_numbering_and_restores_source_scale():
    tile = tiling._Tile(0, 0, 1280, 960)
    values = [
        detection((100, 200, 500, 400), tile),
        detection((200, 300, 150, 100), tile, confidence=0.95),
        detection((700, 200, 100, 100), tile),
    ]
    state = tiling._ImageState(
        image_input=tiling.TrialQwenImageInput(filename="wall.png", content=b""),
        width=2560, height=1920, processing_width=1280, processing_height=960,
        tiles=[tile], tile_detections=[values], tile_token_usages=[None],
    )
    result = tiling._inference_result(state, model="test-model", provider="qwen", concurrency=1)
    assert [d["id"] for d in result["detections"]] == ["spalling-1", "spalling-2"]
    assert result["detections"][0]["bbox"] == {"x": 200, "y": 400, "width": 1000, "height": 800}
    assert all("_source_tile" not in d for d in result["detections"])
    details = result["inference"]
    assert details["pre_merge_detection_count"] == 3
    assert details["post_cross_tile_merge_detection_count"] == 3
    assert details["post_merge_detection_count"] == 2
    assert details["contained_spalling_removed_count"] == 1
    assert details["pre_nms_detection_count"] == details["post_nms_detection_count"] == 2


@pytest.mark.parametrize("provider", ["qwen", "yolo"])
def test_cloud_and_yolo_inference_merge_large_spalling_regions(provider, monkeypatch):
    runtime = yolo_inference.YoloInferenceRuntime(
        model_id=uuid4(), id=uuid4(), sha256="a" * 64, model="V1", label="test",
        base_url="http://127.0.0.1:19002", timeout_seconds=5,
    )
    monkeypatch.setattr(yolo_runtime, "runtime_url", lambda _: runtime.base_url)
    boxes = [(100, 200, 1180, 400), (0, 200, 1280, 400), (0, 200, 700, 400)]
    calls = []

    def handler(request):
        x, y, width, height = boxes[len(calls)]
        calls.append(request)
        if provider == "yolo":
            value = detection((x, y, width, height))
            return httpx.Response(200, json={
                "model_id": str(runtime.model_id), "version_id": str(runtime.id),
                "sha256": runtime.sha256, "model_version": runtime.model, "detections": [value],
            })
        value = {
            "type": "spalling", "confidence": 0.85, "description": "面砖脱落露出基层",
            "bbox": [x / 1280 * 1000, y / 960 * 1000,
                     (x + width) / 1280 * 1000, (y + height) / 960 * 1000],
        }
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps([value])}}]})

    client_class = httpx.AsyncClient
    monkeypatch.setattr(tiling.httpx, "AsyncClient", lambda **kwargs: client_class(
        transport=httpx.MockTransport(handler), **kwargs
    ))
    content = BytesIO()
    Image.new("RGB", (2800, 960)).save(content, format="PNG")
    image = tiling.TrialQwenImageInput(filename="wall.png", content=content.getvalue())
    if provider == "yolo":
        results = asyncio.run(yolo_inference.infer_yolo_images(
            [image], runtime=runtime, defect_types=["spalling"]
        ))
    else:
        results = asyncio.run(tiling.infer_trial_images(
            [image], api_key="test-key", base_url="http://127.0.0.1:19003/v1",
            visible_defect_types=["spalling"], max_concurrency=1,
        ))
    assert len(calls) == 3
    result = results[0]
    assert len(result["detections"]) == 1
    assert result["detections"][0]["bbox"] == pytest.approx(
        {"x": 100, "y": 200, "width": 2520, "height": 400}
    )
    assert result["detections"][0]["id"] == "spalling-1"
    assert result["inference"]["pre_merge_detection_count"] == 3
    assert result["inference"]["post_merge_detection_count"] == 1

    # Both quick and professional result archives must record the same
    # merged geometry and diagnostics, so reports use the resulting count.
    quick = reports._trial_model_output_from_inference(
        entry={"photo_id": str(uuid4()), "filename": "wall.png"}, inference=result
    )
    formal = detection_tasks._formal_raw_model_output(
        SimpleNamespace(id=uuid4(), original_filename="wall.png"), result
    )
    for archive in (quick, formal):
        assert len(archive["detections"]) == 1
        assert archive["detections"][0]["bbox"] == result["detections"][0]["bbox"]
        assert archive["post_merge_detection_count"] == 1
        assert archive["spalling_overlap_band_iou_threshold"] == tiling.SPALLING_OVERLAP_BAND_IOU_THRESHOLD
        assert archive["spalling_containment_ios_threshold"] == tiling.SPALLING_CONTAINMENT_IOS_THRESHOLD

    entry = {"photo_id": quick["photo_id"], "filename": "wall.png"}
    findings = reports._trial_findings_from_inference(entry=entry, inference=result)
    archive = reports._trial_archive_data(
        result_no="MERGE-TEST", generated_at=datetime.now(UTC), models=["脱落"],
        photos=[{"id": entry["photo_id"], "original_filename": "wall.png"}],
        findings=findings, raw_model_outputs=[quick],
    )
    assert len(findings) == len(archive["defects"]) == 1
    assert archive["summary"]["total_review_results"] == 1
    assert archive["summary"]["by_defect_type"] == {"spalling": 1}
    assert archive["defects"][0]["defect_no"] == "脱落-001"


def test_multiple_detection_strategies_sum_all_merge_stage_counts():
    outputs = [
        {"inference": {"pre_merge_detection_count": 5, "post_cross_tile_merge_detection_count": 3,
                       "post_merge_detection_count": 2, "contained_spalling_removed_count": 1}},
        {"inference": {"pre_merge_detection_count": 4, "post_cross_tile_merge_detection_count": 2,
                       "post_merge_detection_count": 2, "contained_spalling_removed_count": 0}},
    ]
    details = detection_strategies.merge_results(outputs)["inference"]
    assert details["pre_merge_detection_count"] == 9
    assert details["post_cross_tile_merge_detection_count"] == 5
    assert details["post_merge_detection_count"] == 4
    assert details["contained_spalling_removed_count"] == 1
