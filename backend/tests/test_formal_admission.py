import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api import detection_tasks
from app.api.dependencies import AuthenticatedUser
from app.schemas.phase5 import DetectionStartRequest


@pytest.fixture
def admission_case(monkeypatch):
    project = SimpleNamespace(id=uuid4(), status="draft", setup_step=3, facade_type="tile")
    photo = SimpleNamespace(id=uuid4(), precheck_status="passed", photo_type="visible")
    user = AuthenticatedUser(uuid4(), "customer", None, "customer", None)
    runtime = SimpleNamespace(configured=True, provider="qwen", label="Qwen", upstream_provider="qwen",
                              model="test-model", max_concurrency=5, timeout_seconds=300)
    scheduling = SimpleNamespace(global_job_concurrency=2, trial_photo_detection_limit=1000,
                                 formal_photo_detection_limit=1000, generate_limit_per_user=5)
    prompts = SimpleNamespace(visible_prompt_for_models=lambda _: "test prompt", thermal_prompt="test thermal")
    specialized = SimpleNamespace(visible_prompts={}, visible_prompt="test prompt", thermal_prompt="test thermal",
                                  visible_file=None, thermal_file=None, visible_files={})

    class FakeDb:
        def __init__(self):
            self.added = []
            self.commits = 0

        def scalars(self, *_):
            return [photo]

        def scalar(self, *_):
            return None

        def add(self, item):
            self.added.append(item)

        def flush(self):
            for item in self.added:
                if item.id is None:
                    item.id = uuid4()

        def commit(self):
            self.commits += 1

        def refresh(self, _):
            pass

    db = FakeDb()
    queued, charged, releases = [], [], []
    reservation = SimpleNamespace(release=lambda **kw: releases.append(kw))
    monkeypatch.setattr(detection_tasks, "_get_project_or_404", lambda *_: project)
    monkeypatch.setattr(detection_tasks, "ensure_project_write_access", lambda *_: None)
    monkeypatch.setattr(detection_tasks, "active_trial_inference_runtime", lambda *_: runtime)
    monkeypatch.setattr(detection_tasks, "resolve_plan", lambda *_args, **_kwargs: [SimpleNamespace(runtime=runtime, snapshot={})])
    monkeypatch.setattr(detection_tasks, "trial_scheduling_settings", lambda *_: scheduling)
    monkeypatch.setattr(detection_tasks, "trial_prompts", lambda *_: prompts)
    monkeypatch.setattr(detection_tasks, "formal_detection_prompts", lambda *_args, **_kwargs: specialized)
    monkeypatch.setattr(detection_tasks, "reserve_inference_usage", lambda *_args, **_kwargs: reservation)
    monkeypatch.setattr(detection_tasks, "reserve_photo_detection_quota", lambda *_args, **kwargs: charged.append(kwargs))
    monkeypatch.setattr(detection_tasks, "add_photo_detection_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(detection_tasks, "_schedule_formal_project_inference", lambda **job: queued.append(job))
    monkeypatch.setattr(detection_tasks, "_task_read", lambda task: task)
    return SimpleNamespace(project=project, db=db, user=user, reservation=reservation,
                           queued=queued, charged=charged, releases=releases)


def start(case):
    return asyncio.run(detection_tasks.start_detection(
        case.project.id, DetectionStartRequest(model_types=["spalling"]), case.db, case.user,
    ))


def test_concurrent_task_is_rejected_before_persistence_or_photo_charge(monkeypatch, admission_case):
    def busy(*_args, **_kwargs):
        raise HTTPException(429, "同一账号只能同时执行一个检测任务。")

    monkeypatch.setattr(detection_tasks, "reserve_inference_usage", busy)
    with pytest.raises(HTTPException) as raised:
        start(admission_case)
    assert raised.value.status_code == 429
    assert admission_case.project.status == "draft"
    assert admission_case.db.added == []
    assert admission_case.db.commits == 0
    assert admission_case.charged == []
    assert admission_case.queued == []


def test_admitted_task_passes_its_existing_reservation_to_the_job(admission_case):
    task = start(admission_case)
    assert task.status == "pending"
    assert admission_case.db.commits == 1
    assert len(admission_case.charged) == 1
    assert admission_case.queued[0]["usage_reservation"] is admission_case.reservation
    assert admission_case.releases == []


def test_photo_quota_failure_releases_the_reserved_job_slot(monkeypatch, admission_case):
    def no_quota(*_args, **_kwargs):
        raise HTTPException(429, "照片额度不足")

    monkeypatch.setattr(detection_tasks, "reserve_photo_detection_quota", no_quota)
    with pytest.raises(HTTPException, match="照片额度不足"):
        start(admission_case)
    assert admission_case.db.commits == 0
    assert admission_case.queued == []
    assert admission_case.releases == [{"successful": False}]
