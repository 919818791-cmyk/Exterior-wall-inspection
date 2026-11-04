"""Add independent photo-library wall classifications.

Revision ID: 0060_photo_library_facades
Revises: 0059_yolo_model_catalog_editing
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0060_photo_library_facades"
down_revision = "0059_yolo_model_catalog_editing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "photo_library_classification",
        sa.Column("photo_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("facade_type", sa.String(32), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("user_account.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("facade_type IN ('tile', 'coating', 'plaster', 'panel', 'curtain_wall', 'stone')", name="facade_type"),
    )


def downgrade() -> None:
    op.drop_table("photo_library_classification")
