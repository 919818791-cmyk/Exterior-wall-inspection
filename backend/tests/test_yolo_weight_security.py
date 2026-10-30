"""Upload/start checks never execute checkpoint pickle code."""
from hashlib import sha256
from io import BytesIO
import pickle
import zipfile
from uuid import UUID

from fastapi import HTTPException
import pytest
from sqlalchemy import select

from app.models.tables import YoloModelVersion
from app.services import yolo_runtime
from app.services.yolo_weights import MAX_PICKLE_BYTES, UnsafeYoloWeights, validate_yolo_weights
from test_yolo_models import registry, upload
from test_yolo_runtime import container, enabled, version
from yolo_weights_helpers import TEST_WEIGHTS, checkpoint_bytes


class MaliciousReduce:
    def __init__(self, marker):
        self.marker = str(marker)

    def __reduce__(self):
        return exec, (f"open({self.marker!r}, 'w').write('executed')",)


@pytest.mark.parametrize("wrapped", [False, True])
def test_malicious_upload_is_rejected_without_storage_or_execution(registry, tmp_path, wrapped):
    marker = tmp_path / "pickle-executed"
    payload = MaliciousReduce(marker)
    content = checkpoint_bytes({"model": payload}) if wrapped else pickle.dumps(payload, protocol=2)
    response = upload(registry, content=content)
    assert response.status_code == 422
    assert not marker.exists()
    assert registry.objects == {}
    assert registry.db.scalar(select(YoloModelVersion)) is None


@pytest.mark.parametrize("content", [
    b"not-a-checkpoint",
    checkpoint_bytes(metadata=b"\x80\x02cbuiltins\neval\n."),
    checkpoint_bytes(metadata=b"\x80\x02cultralytics.nn.tasks\nUnreviewedModel\n."),
    checkpoint_bytes(metadata=b"\x80\x02cultralytics.nn.tasks\nDetectionModel\n}\x85R."),
    # Reusing a class through a memo must not allow a constructor REDUCE either.
    checkpoint_bytes(metadata=b"\x80\x02cultralytics.nn.tasks\nDetectionModel\nq\x00h\x00}\x85R."),
    checkpoint_bytes(metadata=b"\x80\x04\x8c\x08builtins\x8c\x04exec\x93."),
    checkpoint_bytes(metadata=b"\x80\x02\x82\x01."),
    checkpoint_bytes(metadata=b"\x80\x02}.")[:-12],
    checkpoint_bytes(metadata=b"\x80\x02}.trailing"),
    checkpoint_bytes(metadata=b"\x80\x02X"),
    checkpoint_bytes(extra={"archive/constants.pkl": b"code"}),
    checkpoint_bytes(extra={"archive/code/model.py": b"code"}),
    checkpoint_bytes(extra={"archive/../evil": b"code"}),
    checkpoint_bytes(extra={"other/data.pkl": b"code"}),
])
def test_invalid_or_executable_formats_fail_closed(content):
    source = BytesIO(content)
    with pytest.raises(UnsafeYoloWeights):
        validate_yolo_weights(source)
    assert source.tell() == 0


def test_metadata_limit_and_compressed_archives_are_rejected():
    source = BytesIO(checkpoint_bytes(metadata=b"x" * (MAX_PICKLE_BYTES + 1)))
    with pytest.raises(UnsafeYoloWeights, match="过大"):
        validate_yolo_weights(source)
    output = BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("archive/data.pkl", pickle.dumps({}, protocol=2))
    output.seek(0)
    with pytest.raises(UnsafeYoloWeights):
        validate_yolo_weights(output)


def test_valid_preflight_preserves_stream_for_storage():
    source = BytesIO(TEST_WEIGHTS)
    validate_yolo_weights(source)
    assert source.read() == TEST_WEIGHTS


@pytest.mark.parametrize("cached", [False, True])
def test_historical_payload_cannot_start_even_with_matching_hash(version, enabled, monkeypatch, tmp_path, cached):
    marker = tmp_path / "pickle-executed"
    content = checkpoint_bytes({"model": MaliciousReduce(marker)})
    version.file_size, version.sha256 = len(content), sha256(content).hexdigest()
    folder = tmp_path / version.id.hex
    folder.mkdir()
    if cached:
        (folder / "weights.pt").write_bytes(content)
    response = BytesIO(content)
    response.release_conn = lambda: None
    monkeypatch.setattr(yolo_runtime.object_storage, "open_object", lambda *_: response)
    monkeypatch.setattr(yolo_runtime, "_inspect", lambda _: None)
    monkeypatch.setattr(yolo_runtime, "_docker", lambda *_args, **_kwargs: pytest.fail("Docker must not start"))
    with pytest.raises(HTTPException) as error:
        yolo_runtime.control_version(version, "start")
    assert error.value.status_code == 422
    assert not marker.exists()
    assert not (folder / "weights.pt.part").exists()
    if not cached:
        assert response.closed
        assert not (folder / "weights.pt").exists()


def test_http_start_rejects_previously_uploaded_payload(registry, enabled, monkeypatch, tmp_path):
    created = registry.client.post("/api/yolo-models", json={"name": "历史权重回归"})
    assert created.status_code == 201
    uploaded = upload(registry, kind=created.json()["id"])
    assert uploaded.status_code == 201
    item = uploaded.json()
    marker = tmp_path / "pickle-executed"
    content = checkpoint_bytes({"model": MaliciousReduce(marker)})
    # Simulate a malicious file registered before this fix, with valid identity.
    stored = registry.db.get(YoloModelVersion, UUID(item["id"]))
    stored.file_size, stored.sha256 = len(content), sha256(content).hexdigest()
    registry.objects[stored.storage_object_key] = content
    registry.db.commit()
    response = BytesIO(content)
    response.release_conn = lambda: None
    monkeypatch.setattr(yolo_runtime.object_storage, "open_object", lambda *_: response)
    monkeypatch.setattr(yolo_runtime, "_inspect", lambda _: None)
    monkeypatch.setattr(yolo_runtime, "_docker", lambda *_args, **_kwargs: pytest.fail("Docker must not start"))
    started = registry.client.post(f"/api/yolo-models/{item['model_id']}/versions/{item['id']}/runtime/start")
    assert started.status_code == 422
    assert not marker.exists()


@pytest.mark.parametrize("running", [False, True])
def test_old_container_cannot_bypass_weight_policy(version, enabled, monkeypatch, running):
    legacy = container(version, running=running)
    legacy["Config"]["Labels"].pop(f"{yolo_runtime.LABEL_PREFIX}.weight-policy")
    monkeypatch.setattr(yolo_runtime, "_inspect", lambda _: legacy)
    monkeypatch.setattr(yolo_runtime, "_weights", lambda *_: None)
    calls = []
    from types import SimpleNamespace
    monkeypatch.setattr(yolo_runtime, "_docker", lambda *args, **_: calls.append(args) or SimpleNamespace(returncode=0))
    if running:
        assert yolo_runtime.version_status(version).state == "failed"
        with pytest.raises(HTTPException, match="先停止"):
            yolo_runtime.control_version(version, "start")
        assert calls == []
    else:
        monkeypatch.setattr(yolo_runtime, "_status", lambda _: yolo_runtime.YoloVersionStatus("starting", "", True))
        yolo_runtime.control_version(version, "start")
        assert calls[0] == ("rm", yolo_runtime._name(version))
        assert calls[1][0] == "run"
        assert f"{yolo_runtime.LABEL_PREFIX}.weight-policy={yolo_runtime.POLICY_VERSION}" in calls[1]
