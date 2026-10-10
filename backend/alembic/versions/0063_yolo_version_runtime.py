"""Remove exclusive YOLO version selection and pin existing strategy bindings.

Revision ID: 0063_yolo_version_runtime
Revises: 0062_detection_strategy_routing
"""
import json
from uuid import UUID

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0063_yolo_version_runtime"
down_revision = "0062_detection_strategy_routing"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    settings = sa.table("system_setting", sa.column("key", sa.String), sa.column("value", sa.Text))
    versions = sa.table("yolo_model_version", sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("model_id", postgresql.UUID(as_uuid=True)), sa.column("is_active", sa.Boolean))
    for row in connection.execute(sa.select(settings).where(settings.c.key.startswith("detection_strategy:"))):
        value = json.loads(row.value)
        if value.get("model_kind") != "yolo" or value.get("version_id"):
            continue
        try:
            model_id = UUID(value.get("model_id") or "")
        except ValueError:
            continue
        identifier = connection.scalar(sa.select(versions.c.id).where(
            versions.c.model_id == model_id, versions.c.is_active.is_(True)))
        if identifier:
            value["version_id"] = str(identifier)
            connection.execute(settings.update().where(settings.c.key == row.key).values(value=json.dumps(value)))
    # Historical flags and weights remain intact; flags no longer drive runtime state.
    op.drop_index("uq_yolo_model_active_version", table_name="yolo_model_version")


def downgrade():
    # Explicit strategy versions remain valid under the older application.
    op.create_index("uq_yolo_model_active_version", "yolo_model_version", ["model_id"], unique=True,
        postgresql_where=sa.text("is_active"), sqlite_where=sa.text("is_active = 1"))
