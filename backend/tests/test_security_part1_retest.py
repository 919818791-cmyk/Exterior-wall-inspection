"""Behavioral regression for the second Part 1 scan, without real DB writes."""
from contextlib import nullcontext
from decimal import Decimal
import importlib.util
from ipaddress import IPv4Address
from pathlib import Path
import socket
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import backfill_photo_projection_pose as pose, backfill_photo_thumbnails as thumbnails
from app.db import check_connection, harden_production_accounts as accounts
from app.models.tables import Photo
from app.services import defect_area, vision_models
from test_yolo_runtime import container, enabled, version
from app.services import yolo_runtime


@pytest.fixture
def launcher():
    path = Path(__file__).resolve().parents[2] / "algorithm-model" / "serve_version.py"
    spec = importlib.util.spec_from_file_location("serve_version_retest", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_launcher_uses_one_concrete_interface_and_keeps_service_port(launcher, monkeypatch):
    import uvicorn
    address = str(IPv4Address(0xAC110002))
    def resolve(host, port, **kwargs):
        assert host == socket.gethostname() and port is None
        assert kwargs == {"family": socket.AF_INET, "type": socket.SOCK_STREAM}
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 0))] * 2
    monkeypatch.setattr(launcher.socket, "getaddrinfo", resolve)
    calls = []
    monkeypatch.setattr(uvicorn, "run", lambda app, **kwargs: calls.append((app, kwargs)))
    launcher.main()
    assert calls == [("version_server:app", {"host": address, "port": 9002})]


@pytest.mark.parametrize("addresses", [[], [str(IPv4Address(0))], [str(IPv4Address(0x7F000001))],
    [str(IPv4Address(0xE0000001))], [str(IPv4Address(0xFFFFFFFF))],
    [str(IPv4Address(0xA9FE0001))], [str(IPv4Address(0xAC110002)), str(IPv4Address(0xAC110003))]])
def test_launcher_fails_closed_for_invalid_or_ambiguous_interfaces(launcher, monkeypatch, addresses):
    monkeypatch.setattr(launcher.socket, "getaddrinfo", lambda *_args, **_kwargs:
        [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 0)) for address in addresses])
    with pytest.raises(RuntimeError):
        launcher.container_bind_address()


def test_launcher_does_not_fall_back_after_dns_failure(launcher, monkeypatch):
    def fail(*_args, **_kwargs):
        raise socket.gaierror("unavailable")
    monkeypatch.setattr(launcher.socket, "getaddrinfo", fail)
    with pytest.raises(socket.gaierror):
        launcher.container_bind_address()


def test_legacy_container_is_recreated_only_after_stop(version, enabled, monkeypatch):
    legacy = container(version, running=False)
    legacy["Config"]["Labels"].pop(f"{yolo_runtime.LABEL_PREFIX}.binding")
    monkeypatch.setattr(yolo_runtime, "version_status", lambda _: yolo_runtime.YoloVersionStatus("stopped", "", True))
    monkeypatch.setattr(yolo_runtime, "_inspect", lambda _: legacy)
    monkeypatch.setattr(yolo_runtime, "_weights", lambda *_: None)
    monkeypatch.setattr(yolo_runtime, "_status", lambda _: yolo_runtime.YoloVersionStatus("starting", "", True))
    calls = []
    monkeypatch.setattr(yolo_runtime, "_docker", lambda *args, **_: calls.append(args) or SimpleNamespace(returncode=0))
    assert yolo_runtime.control_version(version, "start").state == "starting"
    assert calls[0] == ("rm", yolo_runtime._name(version))
    assert calls[1][0] == "run" and calls[1][-1] == "/runtime/serve_version.py"


def test_running_legacy_container_requires_stop_instead_of_silent_reuse(version, enabled, monkeypatch):
    legacy = container(version)
    legacy["Config"]["Labels"].pop(f"{yolo_runtime.LABEL_PREFIX}.binding")
    monkeypatch.setattr(yolo_runtime, "_inspect", lambda _: legacy)
    assert yolo_runtime.version_status(version).state == "failed"
    monkeypatch.setattr(yolo_runtime, "_docker", lambda *_args, **_kwargs: pytest.fail("Running container must not be removed"))
    from fastapi import HTTPException
    with pytest.raises(HTTPException, match="先停止"):
        yolo_runtime.control_version(version, "start")


def test_current_stopped_container_is_restarted_without_recreation(version, enabled, monkeypatch):
    monkeypatch.setattr(yolo_runtime, "_inspect", lambda _: container(version, running=False))
    monkeypatch.setattr(yolo_runtime, "_weights", lambda *_: None)
    monkeypatch.setattr(yolo_runtime, "_status", lambda _: yolo_runtime.YoloVersionStatus("starting", "", True))
    monkeypatch.setattr(yolo_runtime, "version_status", lambda _: yolo_runtime.YoloVersionStatus("stopped", "", True))
    calls = []
    monkeypatch.setattr(yolo_runtime, "_docker", lambda *args, **_: calls.append(args) or SimpleNamespace(returncode=0))
    assert yolo_runtime.control_version(version, "start").state == "starting"
    assert calls == [("start", yolo_runtime._name(version))]


def test_systemctl_environment_cannot_be_redirected_or_inject_libraries(monkeypatch):
    for name, value in {"XDG_RUNTIME_DIR": "/attacker", "DBUS_SESSION_BUS_ADDRESS": "unix:path=/attacker/bus",
        "PATH": "/attacker/bin", "LD_PRELOAD": "/attacker/lib.so", "SYSTEMD_BUS_ADDRESS": "unix:path=/attacker/bus"}.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(vision_models.os, "getuid", lambda: 1234)
    assert vision_models._systemd_user_env() == {"XDG_RUNTIME_DIR": "/run/user/1234",
        "DBUS_SESSION_BUS_ADDRESS": "unix:path=/run/user/1234/bus", "LANG": "C.UTF-8"}


def test_measurement_reader_rejects_unlisted_attributes_for_both_input_types():
    class Trap:
        @property
        def secret(self):
            pytest.fail("Unlisted attribute must never be read")
    assert defect_area._value(Trap(), "secret") is None
    assert defect_area._value({"secret": "private"}, "secret") is None


def test_measurement_reader_preserves_expired_orm_descriptor_loading():
    engine = create_engine("sqlite://")
    Photo.__table__.create(engine)
    try:
        with Session(engine) as db:
            photo = Photo(project_id=uuid4(), upload_batch_id=uuid4(), photo_type="visible",
                original_filename="test.jpg", mime_type="image/jpeg", file_size=1,
                storage_bucket="test", storage_object_key="test.jpg",
                calibrated_focal_length=3000, lrf_target_distance=6)
            db.add(photo)
            db.commit()
            db.expire(photo)
            assert "calibrated_focal_length" not in photo.__dict__
            assert defect_area.approximate_bbox_area_m2(photo, {"width": 100, "height": 50}) == Decimal("0.020000")
    finally:
        engine.dispose()


def test_connection_cli_keeps_identical_output(monkeypatch, capsys):
    engine = create_engine("sqlite://")
    monkeypatch.setattr(check_connection, "engine", engine)
    try:
        check_connection.main()
        assert capsys.readouterr().out == "database connection ok: 1\n"
    finally:
        engine.dispose()


def test_pose_backfill_keeps_counts_and_sanitized_failure(monkeypatch, capsys):
    photos = [Photo(id=uuid4()) for _ in range(4)]
    for field in pose.METADATA_FIELDS:
        setattr(photos[0], field, "present")
    for index, photo in enumerate(photos):
        photo.storage_bucket, photo.storage_object_key = "test", str(index)
    commits, rollbacks = [], []
    db = SimpleNamespace(scalars=lambda _: photos, commit=lambda: commits.append(True), rollback=lambda: rollbacks.append(True))
    monkeypatch.setattr(pose, "SessionLocal", lambda: nullcontext(db))
    def read(_bucket, key):
        if key == "3":
            raise ValueError("SECRET_KEY=private\nforged")
        return key.encode()
    def metadata(content):
        return {key: (42 if key == "longitude" and content.getvalue() == b"1" else None) for key in pose.METADATA_FIELDS.values()}
    monkeypatch.setattr(pose, "get_object_bytes", read)
    monkeypatch.setattr(pose, "extract_formal_photo_metadata", metadata)
    pose.main()
    output = capsys.readouterr().out
    assert output == "Photo pose backfill failed: " + str(photos[3].id) + " (ValueError)\nPhoto pose backfill complete: completed=1, skipped=1, unavailable=1, failed=1\n"
    assert len(commits) == 1 and len(rollbacks) == 1


def test_thumbnail_backfill_keeps_success_failure_and_summary_output(monkeypatch, capsys):
    photos = [Photo(id=uuid4(), storage_bucket="test", storage_object_key=str(i)) for i in range(3)]
    commits, rollbacks = [], []
    db = SimpleNamespace(scalars=lambda _: photos, commit=lambda: commits.append(True), rollback=lambda: rollbacks.append(True))
    def build(_bucket, key):
        if key == "2":
            raise ValueError("SECRET_KEY=private\nforged")
        return SimpleNamespace(object_key="thumbnail.jpg", source_width=100, source_height=50) if key == "0" else None
    monkeypatch.setattr(thumbnails, "backfill_stored_thumbnail", build)
    assert thumbnails._backfill_model(db, Photo) == (1, 2)
    assert capsys.readouterr().out == "Thumbnail backfill failed: photo " + str(photos[2].id) + " (ValueError)\n"
    assert photos[0].thumbnail_object_key == "thumbnail.jpg"
    assert len(commits) == len(rollbacks) == 1
    monkeypatch.setattr(thumbnails, "SessionLocal", lambda: nullcontext(db))
    monkeypatch.setattr(thumbnails, "_backfill_model", lambda _db, model: (1, 2) if model is Photo else (3, 4))
    monkeypatch.setattr(thumbnails, "_backfill_report_snapshots", lambda _: 5)
    thumbnails.main()
    assert capsys.readouterr().out == "Thumbnail backfill complete: formal=1, trial=3, failed=6, report_snapshots=5\n"


def test_account_hardening_preserves_admin_and_count_without_real_writes(monkeypatch, capsys):
    demo = [dict(id=uuid4(), role="customer", password="test"), dict(id=uuid4(), role="admin", password="test")]
    users = [SimpleNamespace(id=row["id"], status="active", password_hash="old") for row in demo]
    monkeypatch.setattr(accounts, "DEMO_USERS", demo)
    monkeypatch.setattr(accounts, "get_settings", lambda: SimpleNamespace(app_env="production", auth_seed_demo_users=False))
    monkeypatch.setattr(accounts, "SessionLocal", lambda: nullcontext(SimpleNamespace(scalars=lambda _: users, commit=lambda: None)))
    monkeypatch.setattr(accounts, "verify_password", lambda *_: True)
    monkeypatch.setattr(accounts, "hash_password", lambda _: "new")
    accounts.main()
    assert users[0].status == "disabled" and users[0].password_hash == "new"
    assert users[1].status == "active" and users[1].password_hash == "old"
    assert capsys.readouterr().out == "Admin accounts were left unchanged.\nDisabled documented non-admin demo accounts: 1\n"
