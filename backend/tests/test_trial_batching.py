import asyncio
from io import BytesIO
from types import SimpleNamespace

import pytest
from PIL import Image

from app.api import reports
from app.services import detection_strategies
from app.services.trial_qwen_inference import (
    TrialQwenImageInput,
    TrialQwenInferenceError,
    estimate_trial_api_request_count,
)


@pytest.fixture
def trial_limits(monkeypatch):
    settings = SimpleNamespace(
        trial_max_image_pixels=64_000_000,
        trial_inference_max_image_pixels=64_000_000,
        trial_max_tiles_per_image=100,
        trial_max_tiles_per_request=1000,
    )
    monkeypatch.setattr(reports, "get_settings", lambda: settings)
    return settings


def image_inputs(count, width, height):
    output = BytesIO()
    with Image.new("RGB", (width, height)) as image:
        image.save(output, format="JPEG")
    return [
        TrialQwenImageInput(filename=f"photo-{index}.jpg", content=output.getvalue())
        for index in range(count)
    ]


def test_21_large_photos_are_detected_in_bounded_batches(monkeypatch, trial_limits):
    images = image_inputs(21, 8000, 6000)
    assert reports._trial_estimated_api_request_count(images) == 1344
    plan = object()
    monkeypatch.setattr(reports, "_trial_strategy_plan", lambda *args: plan)
    calls = []

    async def execute_plan(actual_plan, batch, *, infer, **limits):
        assert actual_plan is plan
        # Exercise the same real validation performed by the inference adapters.
        assert estimate_trial_api_request_count(batch, **limits) <= 1000
        calls.append(len(batch))
        return [{"filename": image.filename} for image in batch]

    monkeypatch.setattr(detection_strategies, "execute_plan", execute_plan)
    results = asyncio.run(reports._trial_inference_requests(images, None, ["裂缝"]))
    assert calls == [15, 6]
    assert [result["filename"] for result in results] == [image.filename for image in images]


@pytest.mark.parametrize("limit", ["trial_max_image_pixels", "trial_max_tiles_per_image"])
def test_batching_preserves_single_image_safety_limits(trial_limits, limit):
    setattr(trial_limits, limit, 1)
    with pytest.raises(TrialQwenInferenceError):
        reports._trial_image_batches(image_inputs(1, 2000, 1000))


def test_exact_batch_budget_does_not_split_early(trial_limits):
    trial_limits.trial_max_tiles_per_request = 2
    batches = reports._trial_image_batches(image_inputs(3, 1280, 960))
    assert [(len(batch), tiles) for batch, tiles in batches] == [(2, 2), (1, 1)]
