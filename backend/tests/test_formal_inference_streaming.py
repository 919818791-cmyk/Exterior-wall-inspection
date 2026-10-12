import asyncio
from io import BytesIO
from types import SimpleNamespace
from uuid import uuid4

import pytest
from PIL import Image

from app.api import detection_tasks
from app.services.trial_qwen_inference import (
    TrialQwenImageInput,
    estimate_trial_api_request_count,
)

from sample_data import fixture_url


def image_input(index, size=(600, 600)):
    content = BytesIO()
    with Image.new("RGB", size) as image:
        image.save(content, format="PNG")
    return TrialQwenImageInput(filename=f"{index}.png", content=content.getvalue(), content_type="image/png", photo_id=uuid4())


LIMITS = dict(max_image_pixels=10_000_000, inference_max_image_pixels=10_000_000,
              max_tiles_per_image=100, max_tiles_per_request=2)


@pytest.mark.parametrize("mode", ["legacy", "strategy", "dedicated"])
def test_formal_job_streams_photos_without_project_tile_limit(monkeypatch, mode):
    images = [image_input(i) for i in range(5)]
    photos = [SimpleNamespace(id=image.photo_id, photo_type="visible", original_filename=image.filename,
                              deleted_at=None, status="uploaded") for image in images]
    project = SimpleNamespace(id=uuid4(), name="batch test", status="queued", deleted_at=None)
    task = SimpleNamespace(id=uuid4(), status="pending")
    rows = [(SimpleNamespace(status="uploaded"), photo) for photo in photos]

    class FakeDb:
        scalar_calls = 0

        def scalar(self, *_):
            self.scalar_calls += 1
            return project if self.scalar_calls == 1 else task

        def scalars(self, *_):
            return photos

        def commit(self):
            pass

        def flush(self):
            pass

        def add(self, _):
            pass

        def close(self):
            pass

    calls = []
    events = []
    releases = []
    runtime = SimpleNamespace(model="test-model", provider="qwen", configured=True, label="test",
                              upstream_provider="qwen", api_key="test", base_url=fixture_url('test.invalid'),
                              timeout_seconds=10, max_concurrency=1)

    async def load_image(photo):
        events.append(("load", photo.id))
        return next(image for image in images if image.photo_id == photo.id)

    async def infer(batch, **kwargs):
        assert kwargs["max_tiles_per_request"] is None
        count = estimate_trial_api_request_count(batch, **{key: kwargs[key] for key in LIMITS})
        events.append(("infer", batch[0].photo_id))
        calls.append([image.photo_id for image in batch])
        return [{"image": {"width": 600, "height": 600}, "detections": [], "model_version": runtime.model,
                 "requested_models": ["crack"], "inference": {"api_request_count": count // len(batch), "tile_count": 1}}
                for _ in batch]

    monkeypatch.setattr("app.db.session.SessionLocal", FakeDb)
    monkeypatch.setattr(detection_tasks, "_task_photos", lambda *_: rows)
    monkeypatch.setattr(detection_tasks, "_formal_image_input", load_image)
    monkeypatch.setattr(detection_tasks, "infer_trial_images", infer)
    monkeypatch.setattr(detection_tasks, "get_settings", lambda: SimpleNamespace(**{"trial_" + key: value for key, value in LIMITS.items()}))
    monkeypatch.setattr(detection_tasks, "reserve_inference_usage", lambda *_args, **_kwargs: SimpleNamespace(release=lambda **kw: releases.append(kw)))
    monkeypatch.setattr(detection_tasks, "build_report_data", lambda *_: {})
    monkeypatch.setattr(detection_tasks, "add_inference_usage_event", lambda *_args, **_kwargs: None)
    execution = SimpleNamespace(defect_types=["crack"], runtime=runtime, prompt="test", key="tile_crack_prompt", snapshot={})
    monkeypatch.setattr(detection_tasks, "restore_plan", lambda *_: [execution])
    asyncio.run(detection_tasks._run_formal_project_inference(
        project_id=project.id, task_id=task.id, actor_id=uuid4(), photo_ids=[photo.id for photo in photos],
        selected_model_types=["crack"], runtime=runtime,
        prompts=SimpleNamespace(visible_prompt_for_models=lambda _: "test", thermal_prompt="test"),
        inference_snapshot=({"strategies": [{}]} if mode == "strategy" else
                            {"prompts": {"visible_by_defect": {"crack": "test"}}} if mode == "dedicated" else {}),
    ))
    assert [len(call) for call in calls] == [1, 1, 1, 1, 1]
    assert events == [event for photo in photos for event in (("load", photo.id), ("infer", photo.id))]
    assert [photo_id for call in calls for photo_id in call] == [photo.id for photo in photos]
    assert task.status == "success"
    assert project.status == "pending_review"
    assert all(photo.status == "detected" for photo in photos)
    assert len(task.result_summary["raw_model_outputs"]) == len(photos)
    assert releases == [{"successful": True, "actual_api_request_count": 5}]
