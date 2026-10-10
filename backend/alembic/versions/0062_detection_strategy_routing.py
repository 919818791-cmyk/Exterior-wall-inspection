"""Add YOLO wall capabilities and seed independent detection strategy routing.

Revision ID: 0062_detection_strategy_routing
Revises: 0061_yolo_multi_detection_types
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0062_detection_strategy_routing"
down_revision = "0061_yolo_multi_detection_types"
branch_labels = None
depends_on = None

STRATEGY_KEYS = (
    "visible_prompt", "crack_prompt", "spalling_prompt", "thermal_prompt",
    "tile_crack_prompt", "tile_spalling_prompt", "tile_visible_prompt", "tile_thermal_prompt",
    "coating_crack_prompt", "coating_peeling_prompt", "coating_crack_peeling_prompt", "coating_thermal_prompt",
    "plaster_crack_prompt", "plaster_spalling_prompt", "plaster_visible_prompt", "plaster_thermal_prompt",
    "panel_damage_prompt", "panel_spalling_prompt", "curtain_wall_damage_prompt",
)


def upgrade():
    capabilities = op.create_table("yolo_model_facade_type",
        sa.Column("model_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("yolo_model.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("facade_type", sa.String(32), primary_key=True),
        sa.CheckConstraint("facade_type IN ('tile', 'coating', 'plaster', 'panel', 'curtain_wall')", name="facade_type"),
    )
    models = sa.table("yolo_model", sa.column("id", postgresql.UUID(as_uuid=True)))
    for wall in ("tile", "coating", "plaster", "panel", "curtain_wall"):
        op.execute(capabilities.insert().from_select(["model_id", "facade_type"], sa.select(models.c.id, sa.literal(wall))))
    for key in STRATEGY_KEYS:
        op.execute(sa.text("""
            INSERT INTO system_setting (key, value, created_at, updated_at)
            SELECT :key,
                CASE WHEN (SELECT value FROM system_setting WHERE key = 'trial_inference_provider') = 'local_qwen'
                THEN :local_value
                ELSE :cloud_value END,
                now(), now()
            ON CONFLICT (key) DO NOTHING
        """).bindparams(key="detection_strategy:" + key,
            local_value='{"model_kind":"local_vlm","model_id":"local_qwen","version_id":null}',
            cloud_value='{"model_kind":"cloud_api","model_id":"qwen","version_id":null}'))


def downgrade():
    # Strategy JSON remains recoverable in system_setting after a downgrade.
    op.drop_table("yolo_model_facade_type")
