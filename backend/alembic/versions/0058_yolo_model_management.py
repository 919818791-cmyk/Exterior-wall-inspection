"""Add YOLO model families and managed weight versions.

Revision ID: 0058_yolo_model_management
Revises: 0057_split_detection_quotas
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0058_yolo_model_management"
down_revision = "0057_split_detection_quotas"
branch_labels = None
depends_on = None


def upgrade() -> None:
    catalog = op.create_table(
        "yolo_model",
        sa.Column("detection_type", sa.String(32), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "detection_type IN ('crack', 'spalling', 'peeling', 'damage', 'moisture', 'hollow')",
            name="detection_type",
        ),
    )
    op.execute(catalog.insert().from_select(
        ["detection_type", "created_at", "updated_at"],
        sa.select(sa.column("detection_type"), sa.func.now(), sa.func.now()).select_from(
            sa.values(sa.column("detection_type", sa.String(32))).data([
                (kind,) for kind in ("crack", "spalling", "peeling", "damage", "moisture", "hollow")
            ]).alias("catalog")
        ),
    ))
    op.create_table(
        "yolo_model_version",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("detection_type", sa.String(32), sa.ForeignKey("yolo_model.detection_type", ondelete="RESTRICT"), nullable=False),
        sa.Column("version", sa.String(64), nullable=False),
        sa.Column("architecture", sa.String(64), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("storage_bucket", sa.String(128), nullable=False),
        sa.Column("storage_object_key", sa.String(512), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("user_account.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("detection_type", "version", name="uq_yolo_model_version_label"),
        sa.CheckConstraint("file_size > 0", name="file_size"),
    )
    op.create_index("uq_yolo_model_active_version", "yolo_model_version", ["detection_type"], unique=True, postgresql_where=sa.text("is_active"))


def downgrade() -> None:
    op.drop_table("yolo_model_version")
    op.drop_table("yolo_model")
