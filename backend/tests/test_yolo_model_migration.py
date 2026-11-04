"""Run against an isolated PostgreSQL schema when the integration URL is set."""
import importlib.util
import os
from pathlib import Path
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import DBAPIError

from app.db.base import Base
from app.models.tables import YoloModel, YoloModelDetectionType, YoloModelVersion, YoloModelFacadeType


def migration(filename):
    path = Path(__file__).parents[1] / "alembic" / "versions" / filename
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def legacy_registry():
    url = os.environ.get("YOLO_MIGRATION_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set YOLO_MIGRATION_TEST_DATABASE_URL for PostgreSQL migration verification")
    engine = sa.create_engine(url)
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            schema = f"yolo_migration_test_{uuid4().hex}"
            connection.execute(sa.text(f'CREATE SCHEMA "{schema}"'))
            connection.execute(sa.text(f'SET LOCAL search_path TO "{schema}"'))
            context = MigrationContext.configure(connection, opts={"target_metadata": Base.metadata})
            with Operations.context(context):
                Operations(context).create_table("user_account", sa.Column("id", sa.Uuid(), primary_key=True))
                migration("0058_yolo_model_management.py").upgrade()
                migration("0059_yolo_model_catalog_editing.py").upgrade()
                connection.execute(sa.text("UPDATE yolo_model SET description = 'saved description', deleted_at = now() WHERE detection_type = 'hollow'"))
                identifier = uuid4()
                connection.execute(sa.text("""
                    INSERT INTO yolo_model_version
                        (id, detection_type, version, architecture, description, original_filename,
                         file_size, sha256, storage_bucket, storage_object_key, is_active, created_at, updated_at)
                    VALUES (:id, 'crack', 'v1', 'YOLO11', 'saved version', 'weights.pt', 12, :sha,
                            'models', 'yolo-models/crack/old/weights.pt', true, now(), now())
                """), {"id": identifier, "sha": "a" * 64})
                before = connection.execute(sa.text("SELECT * FROM yolo_model_version")).mappings().one()
                yield connection, migration("0061_yolo_multi_detection_types.py"), dict(before)
        finally:
            transaction.rollback()
    engine.dispose()


def test_upgrade_and_downgrade_preserve_models_versions_and_storage_keys(legacy_registry):
    connection, revision, before = legacy_registry
    revision.upgrade()
    model_table, version_table = YoloModel.__table__, YoloModelVersion.__table__
    version = connection.execute(sa.select(version_table)).mappings().one()
    assert isinstance(version["model_id"], UUID)
    assert {key: value for key, value in version.items() if key != "model_id"} == {key: value for key, value in before.items() if key != "detection_type"}
    capabilities = connection.execute(sa.select(YoloModelDetectionType.__table__)).mappings().all()
    assert len(capabilities) == 6
    assert next(item for item in capabilities if item["model_id"] == version["model_id"])["detection_type"] == "crack"
    archived = connection.execute(sa.select(model_table).where(model_table.c.description == "saved description")).mappings().one()
    assert archived["deleted_at"] is not None
    assert len(connection.execute(sa.select(model_table)).all()) == 6
    inspector = sa.inspect(connection)
    assert inspector.get_pk_constraint("yolo_model")["constrained_columns"] == ["id"]
    assert next(item for item in inspector.get_unique_constraints("yolo_model_version") if item["name"] == "uq_yolo_model_version_label")["column_names"] == ["model_id", "version"]
    revision.downgrade()
    assert dict(connection.execute(sa.text("SELECT * FROM yolo_model_version")).mappings().one()) == before
    assert sa.inspect(connection).get_pk_constraint("yolo_model")["constrained_columns"] == ["detection_type"]


@pytest.mark.parametrize("capability", ["crack", "peeling"])
def test_downgrade_rejects_overlapping_or_multi_type_models_without_losing_data(legacy_registry, capability):
    connection, revision, _ = legacy_registry
    revision.upgrade()
    model_id = uuid4()
    connection.execute(YoloModel.__table__.insert().values(id=model_id, name="new model"))
    kinds = [capability] if capability == "crack" else ["crack", "peeling"]
    connection.execute(YoloModelDetectionType.__table__.insert(), [{"model_id": model_id, "detection_type": kind} for kind in kinds])
    with pytest.raises(DBAPIError, match="Cannot downgrade YOLO models"):
        with connection.begin_nested():
            revision.downgrade()
    assert connection.scalar(sa.select(sa.func.count()).select_from(YoloModel.__table__)) == 7
    assert connection.scalar(sa.select(sa.func.count()).select_from(YoloModelVersion.__table__)) == 1


@pytest.mark.parametrize("provider", ["qwen", "local_qwen"])
def test_strategy_migration_preserves_provider_prompts_and_existing_bindings(legacy_registry, provider):
    import json
    connection, previous, _ = legacy_registry
    previous.upgrade()
    connection.execute(sa.text("CREATE TABLE system_setting (key varchar(128) PRIMARY KEY, value text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())"))
    connection.execute(sa.text("INSERT INTO system_setting (key, value) VALUES ('trial_inference_provider', :provider), ('formal_tile_crack_prompt', 'saved custom prompt'), ('detection_strategy:crack_prompt', :binding)"), {"provider": provider, "binding": '{"model_kind":"unconfigured","model_id":null,"version_id":null}'})
    revision = migration("0062_detection_strategy_routing.py")
    revision.upgrade()
    facades = connection.execute(sa.select(YoloModelFacadeType.__table__)).mappings().all()
    assert len(facades) == 30
    assert set(item["facade_type"] for item in facades) == {"tile", "coating", "plaster", "panel", "curtain_wall"}
    rows = dict(connection.execute(sa.text("SELECT key, value FROM system_setting")).all())
    assert rows["formal_tile_crack_prompt"] == "saved custom prompt"
    assert json.loads(rows["detection_strategy:crack_prompt"])["model_kind"] == "unconfigured"
    assert json.loads(rows["detection_strategy:tile_visible_prompt"]) == {"model_kind": "local_vlm" if provider == "local_qwen" else "cloud_api", "model_id": provider, "version_id": None}
    revision.downgrade()
    assert connection.scalar(sa.text("SELECT value FROM system_setting WHERE key = 'formal_tile_crack_prompt'")) == "saved custom prompt"


def test_version_runtime_migration_pins_legacy_bindings_and_preserves_weights(legacy_registry):
    import json
    connection, previous, before = legacy_registry
    previous.upgrade()
    connection.execute(sa.text("CREATE TABLE system_setting (key varchar(128) PRIMARY KEY, value text NOT NULL)"))
    version = connection.execute(sa.select(YoloModelVersion.__table__)).mappings().one()
    identifier = uuid4()
    second = {**dict(version), "id": identifier, "version": "v2", "is_active": False}
    connection.execute(YoloModelVersion.__table__.insert().values(**second))
    bindings = {
        "crack_prompt": {"model_kind": "yolo", "model_id": str(version["model_id"]), "version_id": None},
        "visible_prompt": {"model_kind": "yolo", "model_id": str(version["model_id"]), "version_id": str(identifier)},
        "thermal_prompt": {"model_kind": "cloud_api", "model_id": "qwen", "version_id": None},
        "coating_crack_prompt": {"model_kind": "yolo", "model_id": str(uuid4()), "version_id": None},
    }
    for key, value in bindings.items():
        connection.execute(sa.text("INSERT INTO system_setting (key, value) VALUES (:key, :value)"),
            {"key": "detection_strategy:" + key, "value": json.dumps(value)})
    revision = migration("0063_yolo_version_runtime.py")
    revision.upgrade()
    rows = dict(connection.execute(sa.text("SELECT key, value FROM system_setting")).all())
    assert json.loads(rows["detection_strategy:crack_prompt"])["version_id"] == str(before["id"])
    for key in ("visible_prompt", "thermal_prompt", "coating_crack_prompt"):
        assert json.loads(rows["detection_strategy:" + key]) == bindings[key]
    assert connection.execute(sa.select(YoloModelVersion.__table__).where(YoloModelVersion.id == before["id"])).mappings().one() == version
    assert "uq_yolo_model_active_version" not in {item["name"] for item in sa.inspect(connection).get_indexes("yolo_model_version")}
    connection.execute(sa.text("UPDATE yolo_model_version SET is_active = true"))
    assert connection.scalar(sa.text("SELECT count(*) FROM yolo_model_version WHERE is_active")) == 2
    connection.execute(sa.text("UPDATE yolo_model_version SET is_active = false WHERE id = :id"), {"id": identifier})
    revision.downgrade()
    assert "uq_yolo_model_active_version" in {item["name"] for item in sa.inspect(connection).get_indexes("yolo_model_version")}
